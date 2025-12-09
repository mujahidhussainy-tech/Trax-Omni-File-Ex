const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { formatResponse } = require('../utils/helpers');

router.use(authenticate);

router.get('/plans', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM subscription_plans ORDER BY price ASC'
    );

    res.json(formatResponse({
      plans: result.rows.map(plan => ({
        id: plan.id,
        name: plan.name,
        price: parseFloat(plan.price),
        billingPeriod: plan.billing_period,
        features: plan.features?.features || [],
        maxUsers: plan.max_users,
        maxLeads: plan.max_leads
      }))
    }));
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({ message: 'Failed to get plans' });
  }
});

router.get('/current', async (req, res) => {
  try {
    const orgId = req.organizationId;

    const result = await pool.query(
      `SELECT s.*, sp.name as plan_name, sp.price, sp.billing_period, sp.features, sp.max_users, sp.max_leads
       FROM subscriptions s
       JOIN subscription_plans sp ON s.plan_id = sp.id
       WHERE s.organization_id = $1
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [orgId]
    );

    if (result.rows.length === 0) {
      const trialPlan = await pool.query("SELECT * FROM subscription_plans WHERE name = 'Trial'");
      return res.json(formatResponse({
        subscription: null,
        plan: trialPlan.rows[0] ? {
          id: trialPlan.rows[0].id,
          name: trialPlan.rows[0].name,
          price: 0,
          features: trialPlan.rows[0].features?.features || []
        } : null
      }));
    }

    const sub = result.rows[0];
    res.json(formatResponse({
      subscription: {
        id: sub.id,
        status: sub.status,
        trialEndsAt: sub.trial_ends_at,
        currentPeriodStart: sub.current_period_start,
        currentPeriodEnd: sub.current_period_end
      },
      plan: {
        id: sub.plan_id,
        name: sub.plan_name,
        price: parseFloat(sub.price),
        billingPeriod: sub.billing_period,
        features: sub.features?.features || [],
        maxUsers: sub.max_users,
        maxLeads: sub.max_leads
      }
    }));
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ message: 'Failed to get subscription' });
  }
});

router.post('/upgrade', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { planId } = req.body;

    if (!planId) {
      return res.status(400).json({ message: 'Plan ID is required' });
    }

    const plan = await pool.query('SELECT * FROM subscription_plans WHERE id = $1', [planId]);
    if (plan.rows.length === 0) {
      return res.status(404).json({ message: 'Plan not found' });
    }

    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await pool.query(
      'UPDATE subscriptions SET status = $1 WHERE organization_id = $2',
      ['cancelled', orgId]
    );

    const result = await pool.query(
      `INSERT INTO subscriptions (organization_id, plan_id, status, current_period_start, current_period_end)
       VALUES ($1, $2, 'active', NOW(), $3)
       RETURNING *`,
      [orgId, planId, periodEnd]
    );

    res.json(formatResponse({
      subscription: result.rows[0],
      plan: plan.rows[0]
    }, 'Subscription upgraded successfully'));
  } catch (error) {
    console.error('Upgrade error:', error);
    res.status(500).json({ message: 'Failed to upgrade subscription' });
  }
});

router.get('/billing-history', async (req, res) => {
  try {
    const orgId = req.organizationId;

    const result = await pool.query(
      `SELECT s.*, sp.name as plan_name, sp.price
       FROM subscriptions s
       JOIN subscription_plans sp ON s.plan_id = sp.id
       WHERE s.organization_id = $1
       ORDER BY s.created_at DESC`,
      [orgId]
    );

    res.json(formatResponse({
      history: result.rows.map(row => ({
        id: row.id,
        planName: row.plan_name,
        price: parseFloat(row.price),
        status: row.status,
        periodStart: row.current_period_start,
        periodEnd: row.current_period_end,
        createdAt: row.created_at
      }))
    }));
  } catch (error) {
    console.error('Get billing history error:', error);
    res.status(500).json({ message: 'Failed to get billing history' });
  }
});

module.exports = router;
