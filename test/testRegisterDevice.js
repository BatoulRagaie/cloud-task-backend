// testRegisterDevice.js

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const registerDevice = async () => {
  try {
    const response = await fetch('http://localhost:5000/register-device', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ deviceId: 'device-002' }),
    });

    const data = await response.json();
    console.log('✅ Response:', data);
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
};

registerDevice();
