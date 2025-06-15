const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const Device = require('./models/Device');
const Task = require('./models/Task');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/task-files', express.static('tasks'));

const PORT = process.env.PORT || 5000;

// ✅ Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// ✅ Home route
app.get('/', (req, res) => {
  res.send('🚀 Backend is running!');
});

// ✅ Register device
app.post('/register-device', async (req, res) => {
  const { deviceId } = req.body;
  if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });

  let device = await Device.findOne({ deviceId });
  if (!device) {
    device = new Device({ deviceId, status: 'idle' });
    await device.save();
    return res.status(201).json({ message: 'Device registered', device });
  }

  res.json({ message: 'Device already registered', device });
});

// ✅ Get task for device
app.get('/get-task/:deviceId', async (req, res) => {
  const deviceId = req.params.deviceId;
  const device = await Device.findOne({ deviceId });

  if (!device) return res.status(404).json({ error: 'Device not found' });
  if (device.status === 'busy') return res.json({ message: 'Device is still busy' });

  const task = await Task.findOne({
    status: 'pending',
    'inputs.deviceId': null
  }).sort({ priority: 1, createdAt: 1 });

  if (!task) {
    await Device.findOneAndUpdate(
      { deviceId },
      { status: 'idle', lastHeartbeat: new Date() }
    );
    return res.json({ message: 'No task available' });
  }

  const unassignedInput = task.inputs.find(input => input.deviceId === null);
  if (!unassignedInput) {
    await Device.findOneAndUpdate(
      { deviceId },
      { status: 'idle', lastHeartbeat: new Date() }
    );
    return res.json({ message: 'No available input' });
  }

  // ✅ Assign input
  unassignedInput.deviceId = deviceId;
  unassignedInput.assignedAt = new Date();

  await task.save();

  await Device.findOneAndUpdate(
    { deviceId },
    { status: 'busy', lastHeartbeat: new Date() }
  );
  console.log(`📌 Device ${deviceId} marked as busy`);

  const allAssigned = task.inputs.every(input => input.deviceId !== null);
  if (allAssigned) {
    task.status = 'running';
    await task.save();
  }

  res.json({
    taskId: task._id,
    codeUrl: `http://192.168.1.7:5000/task-files/${task.codeFileName}`,
    input: unassignedInput.input
  });
});

// ✅ Submit result
app.post('/submit-result', async (req, res) => {
  const { taskId, deviceId, input, output } = req.body;
  if (!taskId || !deviceId || !input || output === undefined) {
    return res.status(400).json({ error: 'taskId, deviceId, input, and output are required' });
  }

  const task = await Task.findById(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const inputEntry = task.inputs.find(entry =>
    entry.deviceId === deviceId && entry.input === input
  );
  if (!inputEntry) return res.status(400).json({ error: 'This input was not assigned to this device' });

  const resultList = task.result || [];
  const alreadySubmitted = resultList.find(r =>
    r.deviceId === deviceId && r.input === input
  );
  if (alreadySubmitted) {
    return res.status(400).json({ error: 'Result already submitted for this input' });
  }

  if (!task.result) task.result = [];
  task.result.push({ deviceId, input, output });

  if (task.result.length >= task.requiredDeviceCount) {
    task.status = 'done';
  }

  await task.save();

  await Device.findOneAndUpdate(
    { deviceId },
    { status: 'idle', lastHeartbeat: new Date() }
  );

  console.log(`✅ Result from ${deviceId} for input "${input}": ${output}`);
  res.json({ message: 'Result received and saved successfully' });
});

// ✅ Heartbeat
app.post('/heartbeat', async (req, res) => {
  const { deviceId } = req.body;
  if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });

  const device = await Device.findOne({ deviceId });
  if (!device) return res.status(404).json({ error: 'Device not found' });

  if (device.status === 'disconnected') {
    device.status = 'idle';
  }

  device.lastHeartbeat = new Date();
  await device.save();

  res.json({ message: 'Heartbeat received' });
});

// ✅ Get all devices
app.get('/devices', async (req, res) => {
  const devices = await Device.find().sort({ deviceId: 1 });
  res.json(devices);
});

// ✅ Get single device status
app.get('/device-status/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const device = await Device.findOne({ deviceId });

  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  res.json({ status: device.status });
});


// ✅ Monitoring Loop
setInterval(async () => {
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
  const stuckTime = new Date(Date.now() - 2 * 60 * 1000);

  console.log('🧠 [Monitor] Checking devices & stuck tasks...');

  // 🔹 Detect disconnected devices
  const deadDevices = await Device.find({
    status: { $in: ['busy', 'idle'] },
    lastHeartbeat: { $lt: oneMinuteAgo }
  });

  for (let device of deadDevices) {
    device.status = 'disconnected';
    await device.save();
    console.log(`⚠️ Device ${device.deviceId} disconnected`);

    const tasks = await Task.find({
      status: { $in: ['pending', 'running'] },
      'inputs.deviceId': device.deviceId
    });

    for (let task of tasks) {
      let updated = false;
      for (let input of task.inputs) {
        if (input.deviceId === device.deviceId) {
          input.deviceId = null;
          input.assignedAt = null;
          updated = true;
        }
      }

      if (updated) {
        if (task.status === 'running') {
          task.status = 'pending';
        }
        await task.save();
        console.log(`🔄 Reassigned input(s) from ${device.deviceId} in task ${task._id}`);
      }
    }
  }

  // 🔹 Detect stuck tasks (timeout)
  const stuckTasks = await Task.find({
    status: { $in: ['pending', 'running'] },
    inputs: {
      $elemMatch: {
        deviceId: { $ne: null },
        assignedAt: { $lt: stuckTime }
      }
    }
  });

  for (let task of stuckTasks) {
    let updated = false;
    const resultList = task.result || [];

    for (let input of task.inputs) {
      const alreadySubmitted = resultList.find(r =>
        r.deviceId === input.deviceId && r.input === input.input
      );

      if (
        input.deviceId &&
        input.assignedAt &&
        input.assignedAt < stuckTime &&
        !alreadySubmitted
      ) {
        const timedOutDeviceId = input.deviceId;
        input.deviceId = null;
        input.assignedAt = null;
        updated = true;

        await Device.findOneAndUpdate(
          { deviceId: timedOutDeviceId },
          { status: 'idle', lastHeartbeat: new Date() }
        );

        console.log(`⏱ Timeout → Input "${input.input}" re-assigned from device ${timedOutDeviceId}`);
      }
    }

    if (updated) {
      task.status = 'pending';
      await task.save();
    }
  }
}, 60 * 1000);

// ✅ Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
