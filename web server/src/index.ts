import express from 'express';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import dotenv from 'dotenv';
import * as crypto from 'crypto';

dotenv.config();

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/verify/:random/:hashed', (req, res) => {
  const { random, hashed } = req.params;

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Verification</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; }
        button { padding: 10px 20px; font-size: 16px; }
      </style>
    </head>
    <body>
      <h1>Verification</h1>
      <button onclick="showUpload()">Verify here</button>
      <div id="uploadForm" style="display: none; margin-top: 20px;">
        <form action="/submit" method="post" enctype="multipart/form-data">
          <input type="hidden" name="random" value="${random}">
          <input type="hidden" name="hashed" value="${hashed}">
          <input type="file" name="image" accept="image/*,video/*" required>
          <br><br>
          <button type="submit">Confirm</button>
        </form>
      </div>
      <script>
        function showUpload() {
          document.getElementById('uploadForm').style.display = 'block';
        }
      </script>
    </body>
    </html>
  `);
});

app.post('/submit', upload.single('image'), async (req, res) => {
  const { random, hashed } = req.body;
  const file = req.file;

  if (!random || !hashed || !file) {
    return res.status(400).send('Missing data');
  }

  // Send to bot
  const formData = new FormData();
  formData.append('random', random);
  formData.append('image', require('fs').createReadStream(file.path), file.originalname);

  try {
    const response = await axios.post('http://localhost:4070/upload', formData, {
      headers: formData.getHeaders(),
    });
    res.send('<h1>Success! You may return to Discord.</h1>');
  } catch (error) {
    res.status(500).send('Error submitting verification');
  }
});

app.listen(4069, () => {
  console.log('Web server listening on port 4069');
});
