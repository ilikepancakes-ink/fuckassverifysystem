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
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verification</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          text-align: center;
          margin: 0;
          padding: 20px;
          background-color: #f5f5f5;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
        }
        .container {
          max-width: 400px;
          background: white;
          padding: 30px;
          border-radius: 10px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
          color: #333;
          margin-bottom: 30px;
          font-size: 24px;
        }
        button {
          background-color: #007bff;
          color: white;
          border: none;
          padding: 12px 24px;
          font-size: 16px;
          border-radius: 5px;
          cursor: pointer;
          margin: 10px;
          transition: background-color 0.3s;
        }
        button:hover {
          background-color: #0056b3;
        }
        input[type="file"] {
          margin: 20px 0;
          padding: 10px;
          border: 2px dashed #ccc;
          border-radius: 5px;
          width: 100%;
          box-sizing: border-box;
        }
        .upload-form {
          display: none;
          margin-top: 20px;
        }
        @media (max-width: 480px) {
          .container {
            padding: 20px;
            margin: 10px;
          }
          h1 {
            font-size: 20px;
          }
          button {
            width: 100%;
            padding: 15px;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Verification</h1>
        <button onclick="showUpload()">Verify here</button>
        <div id="uploadForm" class="upload-form">
          <form action="/submit" method="post" enctype="multipart/form-data">
            <input type="hidden" name="random" value="${random}">
            <input type="hidden" name="hashed" value="${hashed}">
            <input type="file" name="image" accept="image/*,video/*" required>
            <button type="submit">Confirm</button>
          </form>
        </div>
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

app.use('/uploads', express.static('uploads'));

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
