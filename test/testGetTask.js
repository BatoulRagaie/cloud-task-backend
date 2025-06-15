const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const deviceId = 'device-001';

fetch(`http://localhost:5000/get-task/${deviceId}`)
  .then(res => res.json())
  .then(data => console.log('🟢 Task received:', data))
  .catch(err => console.error('❌ Error:', err));
