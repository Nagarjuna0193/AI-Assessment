// Runs before every test file (jest "setupFiles"). Tests must not depend on
// a developer's local backend/.env: dotenv never overrides a variable that is
// already set, so pinning these here wins over .env.
process.env.AI_MOCK_MODE = 'false';
