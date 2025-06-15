const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

fetch('http://localhost:5000/submit-result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskId: '684eda0fd6767bfb059dcc83',
      deviceId: 'device-002',
      input: '20',
      output: 'Hello from device 002'
  })
})
  .then(res => res.json())
  .then(data => console.log('✅ Server Response:', data))
  .catch(err => console.error('❌ Error:', err));
