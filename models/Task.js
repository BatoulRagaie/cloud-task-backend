const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  codeFileName: { type: String, required: true },
  status: { type: String, default: 'pending' }, // pending | running | done
  
  inputs: [{
    deviceId: { type: String, default: null },
    assignedAt: { type: Date, default: null },
    input: { type: String, required: true }
  }],

  result: {
    type: [{
      deviceId: String,
      input: String,
      output: String
    }],
    default: []
  },
  
  requiredDeviceCount: { type: Number, default: 1 },
  priority: { type: Number, default: 1 },
  dependencies: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Task' }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Task', taskSchema);
