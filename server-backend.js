// backend/server.js
require('dotenv').config();
const express = require('express');
const https = require('https');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3008;
const VIDEO_DIR = path.join(__dirname, 'public/videos'); // Thư mục lưu video cache

// Load chứng chỉ SSL
const options = {

};

// Tạo thư mục nếu chưa có
if (!fs.existsSync(VIDEO_DIR)) {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
}

app.use(express.json());

app.use(cors({
 origin: ['https://agent.chichbong.com:3009'], // Chỉ cho phép từ frontend
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  exposedHeaders: ["Content-Length", "Content-Range"]
}));

//app.use('/videos', express.static(VIDEO_DIR)); // Cung cấp video qua đường dẫn /videos
app.use('/videos', express.static(VIDEO_DIR, {
  setHeaders: (res, path) => {
    res.setHeader("Access-Control-Allow-Origin", "*"); // Cho phép mọi domain truy cập
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); // Cho phép tải từ domain khác
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Accept-Ranges", "bytes"); // Hỗ trợ tải video từng phần
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
}));




app.get('/', (req, res) => {
  res.send("Backend HTTPS server đang chạy!");
});

// **1) Endpoint nhận câu hỏi từ frontend và gọi OpenAI API**
app.post("/ask", async (req, res) => {
	    console.log("DEBUG: Body từ frontend:", req.body); // Kiểm tra dữ liệu gửi lên
    const { text } = req.body;

    if (!text) {
		console.error("ERROR: Thiếu nội dung câu hỏi");
        return res.status(400).json({ error: "Thiếu nội dung câu hỏi" });
    }

    try {
        console.log("DEBUG: Nhận câu hỏi từ frontend:", text);

        const openAIResponse = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
                model: "gpt-4",
                messages: [{ role: "system", content: "Bạn là trợ lý ảo" }, { role: "user", content: text }]
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
                }
            }
        );

        const answer = openAIResponse.data.choices[0].message.content;
        console.log("DEBUG: OpenAI Answer:", answer);
        res.json({ answer });

    } catch (error) {
        console.error("Lỗi OpenAI API:", error.response?.data || error.message);
        res.status(500).json({ error: "Lỗi khi gọi OpenAI API" });
    }
});


// **2) Endpoint gửi văn bản đến D-ID để tạo video và cache về server**
app.post('/d-id/talks', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Văn bản không được để trống.' });
    }

    // 1️⃣ Gửi yêu cầu tạo video D-ID
    const createResponse = await axios.post('https://api.d-id.com/talks', {
      source_url: "https://chichbong.com/gif/videothumb1.png",
      auto_match: true,
      stitch: true,
      script: {
        type: "text",
        input: text,
        provider: { type: "microsoft", voice_id: "vi-VN-HoaiMyNeural" }
      }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${process.env.DID_API_KEY}:${process.env.DID_API_SECRET}`).toString('base64')}`
      }
    });

    const talkId = createResponse.data.id;
    console.log('DEBUG: D-ID Talks ID:', talkId);

    // 2️⃣ Chờ video D-ID sẵn sàng với thời gian tối đa 20 giây
    let videoUrl = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(res => setTimeout(res, 1000));

      const statusResponse = await axios.get(`https://api.d-id.com/talks/${talkId}`, {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${process.env.DID_API_KEY}:${process.env.DID_API_SECRET}`).toString('base64')}`
        }
      });

      if (statusResponse.data.result_url) {
        videoUrl = statusResponse.data.result_url;
        break;
      }
      console.log(`DEBUG: Chờ video D-ID sẵn sàng... (${i + 1}/20)`);
    }

    if (!videoUrl) {
      return res.status(500).json({ error: "D-ID video chưa sẵn sàng sau 20 giây." });
    }

    console.log('DEBUG: D-ID Video URL:', videoUrl);

	res.json({ video_url: videoUrl });


  } catch (err) {
    console.error('ERROR in /d-id/talks:', err.response?.data || err.message);
    res.status(500).json({ error: 'Lỗi khi tạo video từ D-ID Talks.' });
  }
});

// **Chạy server với HTTPS**
https.createServer(options, app).listen(PORT, () => {
  console.log(`✅ Backend HTTPS server chạy tại https://backend.chichbong.com:${PORT}`);
});
