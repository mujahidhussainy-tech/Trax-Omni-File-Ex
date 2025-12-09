const pool = require('../config/database');

const SCORE_WEIGHTS = {
  source: {
    'referral': 30,
    'website': 25,
    'linkedin': 20,
    'facebook': 18,
    'instagram': 18,
    'google': 15,
    'email': 12,
    'cold_call': 10,
    'manual': 5,
    'other': 5
  },
  stage: {
    'won': 100,
    'negotiation': 80,
    'proposal': 60,
    'qualified': 40,
    'contacted': 20,
    'new': 10,
    'lost': 0
  },
  priority: {
    'high': 20,
    'medium': 10,
    'low': 5
  },
  value: {
    threshold1: { min: 0, max: 1000, score: 5 },
    threshold2: { min: 1000, max: 10000, score: 15 },
    threshold3: { min: 10000, max: 50000, score: 25 },
    threshold4: { min: 50000, max: Infinity, score: 35 }
  }
};

const calculateLeadScore = async (leadId, orgId) => {
  try {
    const leadResult = await pool.query(
      `SELECT l.*, ps.name as stage_name 
       FROM leads l
       LEFT JOIN pipeline_stages ps ON l.stage_id = ps.id
       WHERE l.id = $1 AND l.organization_id = $2`,
      [leadId, orgId]
    );

    if (leadResult.rows.length === 0) {
      return null;
    }

    const lead = leadResult.rows[0];
    let score = 0;

    const sourceScore = SCORE_WEIGHTS.source[lead.source?.toLowerCase()] || 5;
    score += sourceScore;

    const stageName = lead.stage_name?.toLowerCase() || 'new';
    const stageScore = SCORE_WEIGHTS.stage[stageName] || 10;
    score += stageScore;

    const priorityScore = SCORE_WEIGHTS.priority[lead.priority?.toLowerCase()] || 10;
    score += priorityScore;

    const value = parseFloat(lead.value) || 0;
    let valueScore = 5;
    for (const [key, threshold] of Object.entries(SCORE_WEIGHTS.value)) {
      if (value >= threshold.min && value < threshold.max) {
        valueScore = threshold.score;
        break;
      }
    }
    score += valueScore;

    const activitiesResult = await pool.query(
      `SELECT COUNT(*) as activity_count FROM lead_activities WHERE lead_id = $1`,
      [leadId]
    );
    const activityCount = parseInt(activitiesResult.rows[0].activity_count) || 0;
    const activityScore = Math.min(activityCount * 5, 30);
    score += activityScore;

    const callLogsResult = await pool.query(
      `SELECT COUNT(*) as call_count FROM call_logs WHERE lead_id = $1`,
      [leadId]
    );
    const callCount = parseInt(callLogsResult.rows[0].call_count) || 0;
    const callScore = Math.min(callCount * 8, 40);
    score += callScore;

    const lastActivityResult = await pool.query(
      `SELECT MAX(created_at) as last_activity FROM lead_activities WHERE lead_id = $1`,
      [leadId]
    );
    const lastActivity = lastActivityResult.rows[0]?.last_activity;
    
    if (lastActivity) {
      const daysSinceActivity = Math.floor((Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceActivity <= 1) {
        score += 20;
      } else if (daysSinceActivity <= 3) {
        score += 15;
      } else if (daysSinceActivity <= 7) {
        score += 10;
      } else if (daysSinceActivity <= 14) {
        score += 5;
      } else {
        score -= 10;
      }
    }

    if (lead.contact_email && lead.contact_phone) {
      score += 10;
    } else if (lead.contact_email || lead.contact_phone) {
      score += 5;
    }

    score = Math.max(0, Math.min(100, score));

    await pool.query(
      `UPDATE leads SET lead_score = $1, last_activity_at = $2, updated_at = NOW() 
       WHERE id = $3 AND organization_id = $4`,
      [score, lastActivity || null, leadId, orgId]
    );

    return score;
  } catch (error) {
    console.error('Error calculating lead score:', error);
    return null;
  }
};

const calculateAllLeadScores = async (orgId) => {
  try {
    const leadsResult = await pool.query(
      'SELECT id FROM leads WHERE organization_id = $1',
      [orgId]
    );

    const scores = [];
    for (const lead of leadsResult.rows) {
      const score = await calculateLeadScore(lead.id, orgId);
      scores.push({ leadId: lead.id, score });
    }

    return scores;
  } catch (error) {
    console.error('Error calculating all lead scores:', error);
    return [];
  }
};

const getScoreCategory = (score) => {
  if (score >= 70) return 'hot';
  if (score >= 40) return 'warm';
  return 'cold';
};

const getScoreColor = (score) => {
  if (score >= 70) return '#EF4444';
  if (score >= 40) return '#F59E0B';
  return '#6B7280';
};

module.exports = {
  calculateLeadScore,
  calculateAllLeadScores,
  getScoreCategory,
  getScoreColor,
  SCORE_WEIGHTS
};
