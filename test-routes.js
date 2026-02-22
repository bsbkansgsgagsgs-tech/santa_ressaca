const express = require('express');
const app = express();
const PORT = 3005; // Use a different port to test logic

app.post('/api/payments/create-preference', (req, res) => {
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Test server on ${PORT}`);
});
