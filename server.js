import express from "express";
import cors from "cors";
import fs from "fs";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

// 🔐 OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ✅ ROOT
app.get("/", (req, res) => {
  res.send("Server is running ✅");
});

// 📦 DB (TEMP - file based)
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

// 🔐 LICENSE VALIDATION
app.post("/validate-license", (req, res) => {
  const { licenseKey, deviceId } = req.body;

  const db = loadDB();
  const key = db.licenses.find(k => k.key === licenseKey);

  if (!key) {
    return res.json({ success: false, valid: false, error: "Invalid key" });
  }

  if (key.deviceId && key.deviceId !== deviceId) {
    return res.json({
      success: false,
      valid: false,
      error: "Used on another device"
    });
  }

  if (!key.deviceId) {
    key.deviceId = deviceId;
  }

  if (new Date() > new Date(key.expiry)) {
    return res.json({
      success: false,
      valid: false,
      error: "Expired"
    });
  }

  saveDB(db);

  res.json({
    success: true,
    valid: true,
    plan: key.plan,
    expiry: key.expiry,
    remainingDays: Math.ceil(
      (new Date(key.expiry) - new Date()) / (1000 * 60 * 60 * 24)
    )
  });
});

// 🔑 GENERATE KEY
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

// 🤖 TEXT AI
app.post("/generate-text", async (req, res) => {
  try {
    const { description } = req.body;

    const prompt = `
Create a high-converting Meesho product listing.

Input:
${description}

Return ONLY JSON:
{
  "product_name": "...",
  "description": "...",
  "price": "...",
  "brand": "...",
  "category": "..."
}
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }]
    });

    let text = response.choices[0].message.content;
    text = text.replace(/```json|```/g, "").trim();

    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.json({ success: false, error: "AI JSON error", raw: text });
    }

    res.json({ success: true, fields: parsed });

  } catch (err) {
    console.error(err);
    res.json({ success: false, error: "AI failed" });
  }
});

// 🧠 FORM AI
app.post("/generate-from-form", async (req, res) => {
  try {
    const { description, formFields } = req.body;

    const fieldList = formFields.map(f => f.label).join(", ");

    const prompt = `
Generate realistic product values for fields:
${fieldList}

Product description:
${description}

Return ONLY JSON:
{
  "field_name": "value"
}
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7
    });

    let text = response.choices[0].message.content;
    text = text.replace(/```json|```/g, "").trim();

    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.json({ success: false, error: "AI JSON error", raw: text });
    }

    const fields = formFields.map(f => ({
      selector: f.selector,
      label: f.label,
      value:
        parsed[f.label] ||
        parsed[f.label?.toLowerCase()] ||
        ""
    }));

    res.json({ success: true, fields });

  } catch (err) {
    console.error(err);
    res.json({ success: false, error: "AI failed" });
  }
});

// 🖼 IMAGE AI
app.post("/generate", async (req, res) => {
  try {
    const { imageUrl } = req.body;
  console.log("REQ BODY:", req.body);
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this product and generate listing details." },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        }
      ]
    });

    res.json({
      success: true,
      result: response.choices[0].message.content
    });

  } catch (err) {
    console.error(err);
    res.json({ success: false, error: "Image AI failed" });
  }
});

// 🚀 START SERVER
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});
