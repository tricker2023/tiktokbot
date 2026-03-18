// api/setup.js
// Truy cập endpoint này 1 lần sau khi deploy để đăng ký webhook
// URL: https://your-app.vercel.app/api/setup

module.exports = async function handler(req, res) {
  const token      = process.env.BOT_TOKEN;
  const webhookUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}/api/webhook`
    : process.env.WEBHOOK_URL;

  if (!token) return res.status(500).json({ error: "BOT_TOKEN chưa được set" });
  if (!webhookUrl) return res.status(500).json({ error: "VERCEL_URL chưa được set" });

  const url = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
  const resp = await fetch(url);
  const data = await resp.json();

  if (data.ok) {
    return res.status(200).json({
      success: true,
      message: `✅ Webhook đã được đăng ký thành công!`,
      webhook_url: webhookUrl,
      telegram_response: data,
    });
  } else {
    return res.status(400).json({
      success: false,
      message: "❌ Đăng ký webhook thất bại",
      telegram_response: data,
    });
  }
};
