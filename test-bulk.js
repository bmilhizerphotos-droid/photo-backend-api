import fetch from 'node-fetch';

async function testBulkAPI() {
  try {
    const response = await fetch('http://localhost:3001/api/photos/bulk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'favorite',
        photoIds: [1]
      })
    });

    const result = await response.json();
    console.log('Bulk API test result:', result);
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testBulkAPI();