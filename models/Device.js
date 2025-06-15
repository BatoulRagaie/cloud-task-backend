const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  status: { type: String, default: 'idle' }, // idle | busy | disconnected
  lastHeartbeat: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Device', deviceSchema);
