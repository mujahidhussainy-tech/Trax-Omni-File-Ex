const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const formatResponse = (data, message = 'Success') => {
  return {
    success: true,
    message,
    data
  };
};

const formatError = (message, statusCode = 400) => {
  return {
    success: false,
    message,
    statusCode
  };
};

const paginate = (query, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;
  return {
    limit: parseInt(limit),
    offset: parseInt(offset),
    page: parseInt(page)
  };
};

module.exports = {
  generateOTP,
  formatResponse,
  formatError,
  paginate
};
