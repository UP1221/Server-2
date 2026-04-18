import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5001;

// 🔐 OpenAI (Railway env)
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY missing in Railway variables");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000
});

// 📦 Upload (image)
const upload = multer({ storage: multer.memoryStorage() });

// 📦 DB (simple file storage)
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

// 🔑 ADMIN
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

// 🧠 PROMPT
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

// ✅ TEXT
app.post("/generate-from-text", async (req, res) => {
  try {
    const { description } = req.body;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: TEXT_PROMPT },
        { role: "user", content: description }
      ]
    });

    let text = response.choices?.[0]?.message?.content || "";
    text = text.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.json({ success: false, error: "AI returned invalid JSON", raw: text });
    }

    res.json({ success: true, fields: parsed });

  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "AI failed" });
  }
});

// 🧠 FORM
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

    let text = response.choices?.[0]?.message?.content || "";
    text = text.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.json({ success: false, error: "AI JSON error", raw: text });
    }

    const fields = formFields.map(f => ({
      selector: f.selector,
      value: parsed[f.label] || ""
    }));

    res.json({ success: true, fields });

  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "AI failed" });
  }
});

// 🖼 IMAGE
// 🖼 IMAGE (FIXED)
app.post("/generate", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.json({ success: false, error: "No image uploaded" });
    }

    const imageB64 = req.file.buffer.toString("base64");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this product and generate listing details." },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageB64}`
              }
            }
          ]
        }
      ]
    });

    res.json({
      success: true,
      result: response.choices?.[0]?.message?.content || ""
    });

  } catch (e) {
    console.error("🔥 IMAGE ERROR:", e);
    res.status(500).json({
      success: false,
      error: e.message || "Image AI failed"
    });
  }
});
// ❤️ HEALTH
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    openai: !!process.env.OPENAI_API_KEY
  });
});

// 🚀 START
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on ${PORT}`);
});

app.get("/test-openai", async (req, res) => {
  try {
    const r = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Say hello" }]
    });
    res.json({ ok: true, reply: r.choices?.[0]?.message?.content });
  } catch (e) {
    console.error("TEST ERROR:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});
