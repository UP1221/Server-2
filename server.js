import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import OpenAI from "openai";
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5001;

// 🔐 OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000
});

// 📦 Upload (image)
const upload = multer({ storage: multer.memoryStorage() });

// 📦 DB (file based license)
const DB_FILE = "./db.json";

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ licenses: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function generateKey() {
  return "MEESHO-" + Math.random().toString(36).substr(2, 8).toUpperCase();
}

// 🔐 LICENSE
app.post("/validate-license", (req, res) => {
  const { licenseKey, deviceId } = req.body;
  const db = loadDB();

  const key = db.licenses.find(k => k.key === licenseKey);
  if (!key) return res.json({ success: false, valid: false });

  if (key.deviceId && key.deviceId !== deviceId) {
    return res.json({ success: false, valid: false, error: "Used on another device" });
  }

  if (!key.deviceId) key.deviceId = deviceId;

  if (new Date() > new Date(key.expiry)) {
    return res.json({ success: false, valid: false, error: "Expired" });
  }

  saveDB(db);

  res.json({ success: true, valid: true });
});

// 🔑 ADMIN KEY
app.post("/admin/generate-key", (req, res) => {
  const { days = 30 } = req.body;
  const db = loadDB();

  const newKey = {
    key: generateKey(),
    plan: "monthly",
    expiry: new Date(Date.now() + days * 86400000),
    deviceId: null
  };

  db.licenses.push(newKey);
  saveDB(db);

  res.json({ success: true, key: newKey });
});

// 🧠 PROMPT (STRONG FROM OLD SERVER)
const TEXT_PROMPT = `
Return ONLY JSON:
{
  "product_name": "",
  "color": "",
  "meesho_price": "",
  "product_mrp": "",
  "inventory": "",
  "supplier_gst_percent": "",
  "hsn_code": "",
  "product_weight_in_gms": "",
  "category": "",
  "brand": "",
  "description": ""
}
`;

// ✅ TEXT GENERATION (FIXED ENDPOINT)
app.post("/generate-from-text", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.json({ success: false, error: "Missing API key" });
    }

    const { description } = req.body;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: TEXT_PROMPT },
        { role: "user", content: description }
      ]
    });

    let text = response.choices[0].message.content;
    text = text.replace(/```json|```/g, "").trim();

    const parsed = JSON.parse(text);

    res.json({ success: true, fields: parsed });

  } catch (e) {
    res.json({ success: false, error: "AI failed" });
  }
});

// 🧠 FORM GENERATION (KEEP OLD STRUCTURE)
app.post("/generate-from-form", async (req, res) => {
  try {
    const { description, formFields } = req.body;

    const prompt = `
Fields: ${formFields.map(f => f.label).join(", ")}
Description: ${description}
Return JSON mapping field -> value
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });

    let text = response.choices[0].message.content;
    text = text.replace(/```json|```/g, "").trim();

    const parsed = JSON.parse(text);

    const fields = formFields.map(f => ({
      selector: f.selector,
      value: parsed[f.label] || ""
    }));

    res.json({ success: true, fields });

  } catch {
    res.json({ success: false, error: "AI failed" });
  }
});

// 🖼 IMAGE GENERATION (FIXED FORMAT)
app.post("/generate", upload.single("image"), async (req, res) => {
  try {
    const imageB64 = req.file.buffer.toString("base64");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe product and generate listing" },
            {
              type: "input_image",
              image_url: `data:image/jpeg;base64,${imageB64}`
            }
          ]
        }
      ]
    });

    res.json({
      success: true,
      result: response.choices[0].message.content
    });

  } catch {
    res.json({ success: false, error: "Image failed" });
  }
});

// ❤️ HEALTH
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// 🚀 START
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on ${PORT}`);
});
