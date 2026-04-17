import express from "express";
import cors from "cors";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

// ✅ ROOT ROUTE (ONLY ONCE)
app.get("/", (req, res) => {
  res.status(200).send("Server is running ✅");
});

// 📦 DB
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

// 🔐 VALIDATE
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
    remainingDays: Math.ceil((new Date(key.expiry) - new Date()) / (1000 * 60 * 60 * 24))
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

// 🤖 AI (dummy)
app.post("/generate-text", (req, res) => {
  res.json({
    title: "Generated Product",
    description: "AI generated description",
    price: 299
  });
});

// ✅ ONLY ONE LISTEN (IMPORTANT)
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});

// 🖼 IMAGE GENERATE
app.post("/generate", (req, res) => {
  res.json({
    success: true,
    result: "Sample product description generated from image"
  });
});

// 🧠 GENERATE FROM FORM
app.post("/generate-from-form", (req, res) => {
  const { description, formFields } = req.body;

  const fields = formFields.map(f => ({
    selector: f.selector,
    label: f.label,
    value: "Sample Value"
  }));

  res.json({
    success: true,
    fields
  });
});

// ✍️ GENERATE FROM TEXT
app.post("/generate-from-text", (req, res) => {
  const { description } = req.body;

  res.json({
    success: true,
    fields: {
      product_name: "Demo Product",
      description: description,
      meesho_price: "299"
    }
  });
});
