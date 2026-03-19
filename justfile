start:
  npm install
  npm run dev

install:
  npm ci

test:
  npm run test

test-unit:
  npm run test:unit

test-integration:
  npm run test:integration

ci:
  npm ci
  npm run test:unit
  npm run test:integration
