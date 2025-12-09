const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const jwtConfig = require('../config/jwt');
const { generateOTP, formatResponse } = require('../utils/helpers');
const { authenticate } = require('../middleware/auth');
const { sendOTPEmail, sendWelcomeEmail } = require('../services/email');

router.post('/register/send-otp', async (req, res) => {
  try {
    const { email, phone, countryCode } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'User already exists with this email' });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const fullPhone = countryCode && phone ? `${countryCode}${phone}` : phone || null;

    await pool.query('DELETE FROM otps WHERE email = $1', [email]);
    await pool.query(
      'INSERT INTO otps (email, phone, otp, type, expires_at) VALUES ($1, $2, $3, $4, $5)',
      [email, fullPhone, otp, 'registration', expiresAt]
    );

    try {
      await sendOTPEmail(email, otp);
      console.log(`OTP sent to ${email}: ${otp}`);
      res.json({ success: true, data: { email }, message: 'Verification code sent to your email' });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      console.log(`OTP for ${email} (email failed): ${otp}`);
      res.json({ success: true, data: { email }, message: 'Verification code generated. Check server logs if email not received.' });
    }
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ success: false, message: 'Failed to send verification code' });
  }
});

router.post('/register/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'User already exists with this email' });
    }

    const existingOtp = await pool.query('SELECT * FROM otps WHERE email = $1 AND type = $2', [email, 'registration']);
    
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    if (existingOtp.rows.length > 0) {
      await pool.query(
        'UPDATE otps SET otp = $1, expires_at = $2, verified = false WHERE email = $3 AND type = $4',
        [otp, expiresAt, email, 'registration']
      );
    } else {
      await pool.query(
        'INSERT INTO otps (email, otp, type, expires_at) VALUES ($1, $2, $3, $4)',
        [email, otp, 'registration', expiresAt]
      );
    }

    try {
      await sendOTPEmail(email, otp);
      console.log(`OTP resent to ${email}: ${otp}`);
      res.json({ success: true, data: { email }, message: 'New verification code sent to your email' });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      console.log(`OTP for ${email} (email failed): ${otp}`);
      res.json({ success: true, data: { email }, message: 'Verification code generated. Check server logs if email not received.' });
    }
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ success: false, message: 'Failed to resend verification code' });
  }
});

router.post('/register/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required' });
    }

    const otpResult = await pool.query(
      'SELECT * FROM otps WHERE email = $1 AND otp = $2 AND type = $3 AND expires_at > NOW() AND verified = false',
      [email, otp, 'registration']
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code' });
    }

    await pool.query('UPDATE otps SET verified = true WHERE id = $1', [otpResult.rows[0].id]);

    res.json({ success: true, data: { verified: true, otp }, message: 'Email verified successfully. Complete your registration.' });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ success: false, message: 'Failed to verify code' });
  }
});

router.post('/register', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { email, password, firstName, lastName, phone, countryCode, organizationName, industry, otp } = req.body;
    
    console.log('=== REGISTRATION ATTEMPT ===');
    console.log('Email:', email);
    console.log('OTP provided:', otp ? 'Yes' : 'No');
    
    if (!email || !password) {
      console.log('Registration failed: Missing email or password');
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    if (!otp) {
      console.log('Registration failed: No OTP provided');
      return res.status(400).json({ success: false, message: 'Please verify your email first' });
    }

    const otpResult = await client.query(
      'SELECT * FROM otps WHERE email = $1 AND otp = $2 AND type = $3 AND expires_at > NOW() AND verified = true',
      [email, otp, 'registration']
    );

    console.log('OTP verification result rows:', otpResult.rows.length);

    if (otpResult.rows.length === 0) {
      console.log('Registration failed: Invalid or expired OTP');
      return res.status(400).json({ success: false, message: 'Invalid or expired verification. Please verify your email again.' });
    }

    const existingUser = await client.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      console.log('Registration failed: User already exists');
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    await client.query('BEGIN');
    console.log('Transaction started');

    await client.query('DELETE FROM otps WHERE email = $1', [email]);
    console.log('OTP deleted');

    const hashedPassword = await bcrypt.hash(password, 10);
    const fullPhone = countryCode && phone ? `${countryCode}${phone}` : phone || '';

    const userResult = await client.query(
      `INSERT INTO users (email, password, first_name, last_name, phone, is_verified) 
       VALUES ($1, $2, $3, $4, $5, true) RETURNING *`,
      [email, hashedPassword, firstName || '', lastName || '', fullPhone]
    );
    const user = userResult.rows[0];
    console.log('User created with ID:', user.id);

    const orgResult = await client.query(
      `INSERT INTO organizations (name, industry, owner_id) 
       VALUES ($1, $2, $3) RETURNING *`,
      [organizationName || `${firstName || 'My'}'s Organization`, industry || 'Other', user.id]
    );
    const organization = orgResult.rows[0];
    console.log('Organization created with ID:', organization.id);

    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role, status) 
       VALUES ($1, $2, 'owner', 'active')`,
      [organization.id, user.id]
    );
    console.log('Organization member created');

    const trialPlan = await client.query("SELECT * FROM subscription_plans WHERE name = 'Trial'");
    if (trialPlan.rows.length > 0) {
      const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await client.query(
        `INSERT INTO subscriptions (organization_id, plan_id, status, trial_ends_at, current_period_start, current_period_end) 
         VALUES ($1, $2, 'trial', $3, NOW(), $3)`,
        [organization.id, trialPlan.rows[0].id, trialEndsAt]
      );
      console.log('Subscription created');
    }

    const defaultStages = ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];
    const stageColors = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#22C55E', '#EF4444'];
    for (let i = 0; i < defaultStages.length; i++) {
      await client.query(
        `INSERT INTO pipeline_stages (organization_id, name, color, position) VALUES ($1, $2, $3, $4)`,
        [organization.id, defaultStages[i], stageColors[i], i]
      );
    }
    console.log('Pipeline stages created');

    await client.query('COMMIT');
    console.log('Transaction committed successfully');

    const token = jwt.sign(
      { userId: user.id, organizationId: organization.id },
      jwtConfig.secret,
      { expiresIn: jwtConfig.expiresIn }
    );

    try {
      await sendWelcomeEmail(user.email, firstName || '');
      console.log(`Welcome email sent to ${user.email}`);
    } catch (emailError) {
      console.error('Welcome email failed (non-critical):', emailError.message);
    }

    console.log('=== REGISTRATION SUCCESSFUL ===');
    console.log('User ID:', user.id);
    console.log('Organization ID:', organization.id);

    res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          phone: user.phone
        },
        organization: {
          id: organization.id,
          name: organization.name,
          industry: organization.industry
        },
        role: 'owner',
        isTrial: true,
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      },
      message: 'Registration successful'
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Rollback error:', rollbackError.message);
    }
    console.error('=== REGISTRATION FAILED ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ success: false, message: 'Registration failed: ' + error.message });
  } finally {
    client.release();
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'You are not registered. Please create an account first.' });
    }
    const user = userResult.rows[0];

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ success: false, message: 'Incorrect password. Please try again.' });
    }

    const orgMember = await pool.query(
      'SELECT organization_id, role FROM organization_members WHERE user_id = $1 LIMIT 1',
      [user.id]
    );
    const organizationId = orgMember.rows.length > 0 ? orgMember.rows[0].organization_id : null;
    const userRole = orgMember.rows.length > 0 ? orgMember.rows[0].role : 'member';

    const token = jwt.sign(
      { userId: user.id, organizationId },
      jwtConfig.secret,
      { expiresIn: jwtConfig.expiresIn }
    );

    let organization = null;
    let isTrial = false;
    let trialEndsAt = null;
    
    if (organizationId) {
      const orgResult = await pool.query('SELECT * FROM organizations WHERE id = $1', [organizationId]);
      if (orgResult.rows.length > 0) {
        organization = {
          id: orgResult.rows[0].id,
          name: orgResult.rows[0].name,
          industry: orgResult.rows[0].industry
        };
      }
      
      const subResult = await pool.query(
        `SELECT s.*, sp.name as plan_name FROM subscriptions s 
         LEFT JOIN subscription_plans sp ON s.plan_id = sp.id 
         WHERE s.organization_id = $1 ORDER BY s.created_at DESC LIMIT 1`,
        [organizationId]
      );
      if (subResult.rows.length > 0) {
        const sub = subResult.rows[0];
        isTrial = sub.status === 'trial';
        trialEndsAt = sub.trial_ends_at;
      }
    }

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          phone: user.phone,
          avatarUrl: user.avatar_url
        },
        organization,
        role: userRole,
        isTrial,
        trialEndsAt
      },
      message: 'Login successful'
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

router.post('/google', async (req, res) => {
  try {
    const { googleId, email, firstName, lastName, avatarUrl } = req.body;
    
    if (!googleId || !email) {
      return res.status(400).json({ success: false, message: 'Google ID and email are required' });
    }

    let user = await pool.query('SELECT * FROM users WHERE google_id = $1 OR email = $2', [googleId, email]);
    
    if (user.rows.length === 0) {
      const hashedPassword = await bcrypt.hash(googleId, 10);
      const result = await pool.query(
        `INSERT INTO users (email, password, first_name, last_name, avatar_url, google_id, is_verified) 
         VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING *`,
        [email, hashedPassword, firstName || '', lastName || '', avatarUrl || '', googleId]
      );
      user = result;

      const orgResult = await pool.query(
        `INSERT INTO organizations (name, owner_id) 
         VALUES ($1, $2) RETURNING *`,
        [`${firstName || 'My'}'s Organization`, result.rows[0].id]
      );
      
      await pool.query(
        `INSERT INTO organization_members (organization_id, user_id, role, status) 
         VALUES ($1, $2, 'owner', 'active')`,
        [orgResult.rows[0].id, result.rows[0].id]
      );

      const trialPlan = await pool.query("SELECT * FROM subscription_plans WHERE name = 'Trial'");
      if (trialPlan.rows.length > 0) {
        const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await pool.query(
          `INSERT INTO subscriptions (organization_id, plan_id, status, trial_ends_at, current_period_start, current_period_end) 
           VALUES ($1, $2, 'trial', $3, NOW(), $3)`,
          [orgResult.rows[0].id, trialPlan.rows[0].id, trialEndsAt]
        );
      }
    } else {
      if (!user.rows[0].google_id) {
        await pool.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, user.rows[0].id]);
      }
    }

    const userData = user.rows[0];
    const orgMember = await pool.query(
      'SELECT organization_id FROM organization_members WHERE user_id = $1 LIMIT 1',
      [userData.id]
    );
    const organizationId = orgMember.rows.length > 0 ? orgMember.rows[0].organization_id : null;

    const token = jwt.sign(
      { userId: userData.id, organizationId },
      jwtConfig.secret,
      { expiresIn: jwtConfig.expiresIn }
    );

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: userData.id,
          email: userData.email,
          firstName: userData.first_name,
          lastName: userData.last_name,
          avatarUrl: userData.avatar_url
        }
      },
      message: 'Google login successful'
    });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({ success: false, message: 'Google authentication failed' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const user = req.user;
    
    let organization = null;
    if (req.organizationId) {
      const orgResult = await pool.query('SELECT * FROM organizations WHERE id = $1', [req.organizationId]);
      if (orgResult.rows.length > 0) {
        organization = orgResult.rows[0];
      }
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          phone: user.phone,
          avatarUrl: user.avatar_url
        },
        organization
      }
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ success: false, message: 'Failed to get user' });
  }
});

module.exports = router;
