// Provide default env vars for all tests.
// These are set before any test file runs so imports that read env at module
// load time (e.g. SCHEDULE_MAX_ATTEMPTS inside generateSchedule) get sensible values.
process.env.PYTHON_API_URL          = 'http://localhost:8000';
process.env.NFL_SEASON              = '2025';
process.env.ADMIN_USERNAME          = 'admin';
// Low value makes scheduler tests fast without retrying thousands of times.
process.env.SCHEDULE_MAX_ATTEMPTS   = '100';