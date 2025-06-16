const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const Device = require('./models/Device');
const Task = require('./models/Task');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/task-files', express.static('tasks'));
app.use('/', express.static('dashboard')); // واجهة المتابعة

const PORT = process.env.PORT || 5000;

// ✅ الاتصال بقاعدة البيانات
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// ✅ إعداد رفع الملفات (كود التاسك)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'tasks'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ✅ رفع تاسك جديدة
app.post('/upload-task', upload.single('codeFile'), async (req, res) => {
  try {
    const { requiredDeviceCount, priority, inputs } = req.body;
    const codeFileName = req.file.filename;
    const parsedInputs = JSON.parse(inputs).map(input => ({ input }));

    const task = new Task({
      codeFileName,
      requiredDeviceCount: parseInt(requiredDeviceCount),
      priority: parseInt(priority),
      inputs: parsedInputs
    });

    await task.save();
    res.json({ message: '✅ Task uploaded successfully', task });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '❌ Failed to upload task' });
  }
});


// ✅ Get all tasks (used by dashboard)
app.get('/all-tasks', async (req, res) => {
  const tasks = await Task.find().sort({ createdAt: -1 });
  res.json(tasks);
});

// ✅ تفاصيل تاسك واحدة
app.get('/task/:id', async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// ✅ تسجيل جهاز جديد
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

// ✅ طلب تاسك
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

  unassignedInput.deviceId = deviceId;
  unassignedInput.assignedAt = new Date();
  await task.save();

  await Device.findOneAndUpdate(
    { deviceId },
    { status: 'busy', lastHeartbeat: new Date() }
  );

  const allAssigned = task.inputs.every(input => input.deviceId !== null);
  if (allAssigned) {
    task.status = 'running';
    await task.save();
  }

  res.json({
    taskId: task._id,
    codeUrl: `https://cloud-task-backend-production.up.railway.app/task-files/${task.codeFileName}`,
    input: unassignedInput.input
  });
});

// ✅ تسليم نتيجة
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

  const alreadySubmitted = (task.result || []).find(r =>
    r.deviceId === deviceId && r.input === input
  );
  if (alreadySubmitted) return res.status(400).json({ error: 'Result already submitted' });

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

  res.json({ message: '✅ Result saved' });
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

  res.json({ message: '💓 Heartbeat received' });
});

// ✅ عرض الأجهزة
app.get('/devices', async (req, res) => {
  const devices = await Device.find().sort({ deviceId: 1 });
  res.json(devices);
});

// ✅ حالة جهاز واحد
app.get('/device-status/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const device = await Device.findOne({ deviceId });
  if (!device) return res.status(404).json({ error: 'Device not found' });
  res.json({ status: device.status });
});

// ✅ مراقبة الأجهزة المعطلة والمتوقفة
setInterval(async () => {
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
  const stuckTime = new Date(Date.now() - 2 * 60 * 1000);

  const deadDevices = await Device.find({
    status: { $in: ['busy', 'idle'] },
    lastHeartbeat: { $lt: oneMinuteAgo }
  });

  for (let device of deadDevices) {
    device.status = 'disconnected';
    await device.save();

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
        if (task.status === 'running') task.status = 'pending';
        await task.save();
      }
    }
  }

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
      }
    }

    if (updated) {
      task.status = 'pending';
      await task.save();
    }
  }
}, 60 * 1000);

// ✅ تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
