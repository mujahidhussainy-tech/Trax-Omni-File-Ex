const https = require('https');

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = 'info@uitrax.com';
const SENDER_NAME = 'Trax Omni';

console.log('Email service initialized');
console.log('BREVO_API_KEY configured:', BREVO_API_KEY ? 'Yes (hidden)' : 'No');
console.log('SENDER_EMAIL:', SENDER_EMAIL);

async function sendEmail(to, subject, htmlContent) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: [{ email: to }],
      subject: subject,
      htmlContent: htmlContent
    });

    const options = {
      hostname: 'api.brevo.com',
      port: 443,
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`Email sent successfully to ${to}`);
          resolve({ success: true, data: JSON.parse(responseData || '{}') });
        } else {
          console.error(`Failed to send email: ${res.statusCode}`, responseData);
          reject(new Error(`Failed to send email: ${responseData}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('Email request error:', error);
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

async function sendOTPEmail(email, otp) {
  const subject = 'Your Trax Omni Verification Code';
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <div style="background: linear-gradient(135deg, #7C3AED 0%, #EC4899 100%); padding: 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Trax Omni</h1>
          <p style="color: #ffffff; opacity: 0.9; margin-top: 5px;">Your CRM Solution</p>
        </div>
        <div style="padding: 40px 30px; text-align: center;">
          <h2 style="color: #333333; margin-bottom: 20px;">Verification Code</h2>
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 30px;">
            Use the following code to verify your email address. This code will expire in 10 minutes.
          </p>
          <div style="background-color: #f8f4ff; border: 2px dashed #7C3AED; border-radius: 10px; padding: 20px; margin: 20px 0;">
            <span style="font-size: 36px; font-weight: bold; color: #7C3AED; letter-spacing: 8px;">${otp}</span>
          </div>
          <p style="color: #999999; font-size: 14px; margin-top: 30px;">
            If you didn't request this code, please ignore this email.
          </p>
        </div>
        <div style="background-color: #f8f8f8; padding: 20px; text-align: center; border-top: 1px solid #eeeeee;">
          <p style="color: #999999; font-size: 12px; margin: 0;">
            &copy; ${new Date().getFullYear()} Trax Omni. All rights reserved.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail(email, subject, htmlContent);
}

async function sendWelcomeEmail(email, firstName) {
  const subject = 'Welcome to Trax Omni!';
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <div style="background: linear-gradient(135deg, #7C3AED 0%, #EC4899 100%); padding: 30px; text-align: center;">
          <div style="width: 60px; height: 60px; background-color: rgba(255,255,255,0.2); border-radius: 12px; margin: 0 auto 15px; display: flex; align-items: center; justify-content: center;">
            <span style="color: #ffffff; font-size: 24px; font-weight: bold;">TO</span>
          </div>
          <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Welcome to Trax Omni!</h1>
        </div>
        <div style="padding: 40px 30px;">
          <h2 style="color: #333333; margin-bottom: 15px;">Hi ${firstName || 'there'},</h2>
          <p style="color: #666666; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
            Congratulations! Your Trax Omni account is now active. Your 7-day free trial has begun.
          </p>
          <div style="background-color: #f8f4ff; border-radius: 10px; padding: 25px; margin: 20px 0;">
            <h3 style="color: #333333; margin: 0 0 15px 0; font-size: 18px;">Get started:</h3>
            <ul style="color: #666666; font-size: 15px; line-height: 2; margin: 0; padding-left: 20px;">
              <li>Add your first lead</li>
              <li>Set up your sales pipeline</li>
              <li>Connect your social accounts</li>
              <li>Invite your team members</li>
            </ul>
          </div>
        </div>
        <div style="background-color: #f8f8f8; padding: 20px; text-align: center; border-top: 1px solid #eeeeee;">
          <p style="color: #666666; font-size: 14px; margin: 0 0 10px 0;">
            Need help? Contact us at <a href="mailto:info@uitrax.com" style="color: #7C3AED;">info@uitrax.com</a>
          </p>
          <p style="color: #999999; font-size: 12px; margin: 0;">
            Powered by <strong>UI TRAX</strong>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail(email, subject, htmlContent);
}

module.exports = {
  sendEmail,
  sendOTPEmail,
  sendWelcomeEmail
};
