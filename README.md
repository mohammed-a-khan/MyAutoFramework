# CS Test Automation Framework

<p align="center">
  <img src="assets/cs-logo.png" alt="CS Test Automation Framework" width="200">
</p>

<p align="center">
  <strong>Enterprise-grade Zero-Code BDD Test Automation Framework with AI-Powered Self-Healing</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#documentation">Documentation</a> •
  <a href="#examples">Examples</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## 🚀 Overview

CS Test Automation Framework is a cutting-edge, production-ready test automation solution that revolutionizes how teams approach testing. With **zero-code capabilities**, **AI-powered self-healing**, and **enterprise-grade features**, it enables both technical and non-technical team members to create and maintain robust test suites.

### 🎯 Key Highlights

- **275+ production-ready components** working seamlessly together
- **200+ generic BDD steps** covering UI, API, and Database testing
- **AI-powered element identification** that learns and adapts
- **Self-healing locators** that fix themselves when UI changes
- **Beautiful branded reports** with customizable themes
- **Full ADO integration** with proxy support
- **Zero external dependencies** for core functionality

## ✨ Features

### 🧪 Testing Capabilities
- ✅ **Web UI Testing** - All browsers (Chrome, Firefox, Safari, Edge)
- ✅ **API Testing** - REST, GraphQL, SOAP with all authentication methods
- ✅ **Database Testing** - SQL Server, Oracle, MySQL, PostgreSQL, MongoDB
- ✅ **Mobile Testing** - Responsive testing with touch gestures
- ✅ **Performance Testing** - Metrics collection and budget validation
- ✅ **Visual Testing** - Screenshot comparison
- ✅ **Accessibility Testing** - WCAG compliance checking
- ✅ **Security Testing** - Basic security validations

### 🤖 AI-Powered Features
- **Natural Language Element Identification** - Describe elements in plain English
- **Self-Healing Locators** - Automatically fixes broken selectors
- **Pattern Recognition** - Identifies common UI patterns
- **Visual Matching** - Finds elements by appearance
- **Smart Suggestions** - Recommends better locators

### 📊 Reporting & Integration
- **Self-contained HTML Reports** - Beautiful, interactive reports
- **PDF/Excel Export** - Multiple format support
- **Real-time Progress** - Live test execution updates
- **ADO Integration** - Seamless test result upload
- **Evidence Collection** - Screenshots, videos, traces
- **Performance Metrics** - Detailed timing analysis

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ and npm 8+
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/cs-automation/cs-test-automation-framework.git
cd cs-test-automation-framework

# Install dependencies and setup
npm run setup

# Copy environment template
cp .env.example .env

# Update .env with your configuration
Running Your First Test
bash# Run all tests in dev environment
npm test -- --env=dev

# Run smoke tests
npm test -- --env=dev --tags=@smoke

# Run specific feature
npm test -- --env=dev --feature=features/login.feature

# Run with specific browser
npm test -- --env=dev --browser=firefox

# Run in parallel
npm test -- --env=dev --parallel --workers=4

# Run with reports
npm test -- --env=dev --report-format=html,pdf
📖 Documentation
Framework Architecture
cs-test-automation-framework/
├── src/                    # Source code
│   ├── core/              # Core framework components
│   │   ├── ai/           # AI system
│   │   ├── browser/      # Browser management
│   │   ├── configuration/# Configuration system
│   │   ├── elements/     # Element management
│   │   └── ...          # Other core modules
│   ├── steps/            # BDD step definitions
│   │   ├── ui/          # UI steps
│   │   ├── api/         # API steps
│   │   └── database/    # Database steps
│   ├── pages/           # Page objects
│   ├── bdd/             # BDD framework
│   └── reporting/       # Reporting system
├── features/            # Test scenarios
├── config/             # Configuration files
├── test-data/          # Test data files
└── reports/            # Generated reports
Writing Tests
1. Create a Feature File
gherkin# features/login.feature
@smoke @critical
Feature: User Login
  As a user
  I want to login to the application
  So that I can access my dashboard

  Background:
    Given user navigates to "https://app.example.com"

  @happy-path
  Scenario: Successful login with valid credentials
    When user types "testuser@example.com" in "Email input"
    And user types "SecurePass123!" in "Password input"
    And user clicks "Login button"
    Then "Dashboard heading" should be visible
    And page title should be "Dashboard - My App"

  @negative @security
  Scenario: Failed login with invalid credentials
    When user types "invalid@example.com" in "Email input"
    And user types "wrongpassword" in "Password input"
    And user clicks "Login button"
    Then "Error message" should be visible
    And "Error message" should have text "Invalid email or password"
2. Run the Test
bash# Run the login feature
npm test -- --env=dev --feature=features/login.feature

# Run with headed browser to see execution
npm test -- --env=dev --feature=features/login.feature --headed

# Run with video recording
npm test -- --env=dev --feature=features/login.feature --video
Using Page Objects
typescript// src/pages/LoginPage.ts
import { CSBasePage } from '@core/pages/CSBasePage';
import { CSGetElement } from '@core/elements/decorators/CSGetElement';
import { CSWebElement } from '@core/elements/CSWebElement';

export class LoginPage extends CSBasePage {
  @CSGetElement({
    locatorType: 'css',
    locatorValue: '#email',
    description: 'Email input',
    aiEnabled: true
  })
  emailInput: CSWebElement;

  @CSGetElement({
    locatorType: 'css',
    locatorValue: '#password',
    description: 'Password input',
    aiEnabled: true
  })
  passwordInput: CSWebElement;

  @CSGetElement({
    locatorType: 'css',
    locatorValue: 'button[type="submit"]',
    description: 'Login button',
    fallbacks: [
      { locatorType: 'text', value: 'Login' },
      { locatorType: 'text', value: 'Sign In' }
    ],
    aiEnabled: true
  })
  loginButton: CSWebElement;

  protected async waitForPageLoad(): Promise<void> {
    await this.page.waitForSelector('#login-form');
  }

  protected async onPageReady(): Promise<void> {
    // Page is ready
  }

  async login(email: string, password: string): Promise<void> {
    await this.emailInput.type(email);
    await this.passwordInput.type(password);
    await this.loginButton.click();
  }
}
API Testing Example
gherkin# features/api/user-api.feature
@api @integration
Feature: User API Testing

  Background:
    Given user is working with "USER_API" API
    And user sets request timeout to 30 seconds

  Scenario: Get user profile
    Given user sets bearer token "${API_TOKEN}"
    When user sends GET request to "/users/profile"
    Then the response status code should be 200
    And the response body should contain "email"
    And the response JSON path "$.role" should equal "admin"
    And user stores response as "userProfile"

  Scenario: Update user profile
    Given user uses response JSON path "$.id" from "userProfile" as request body field "userId"
    And user sets request body to:
      """
      {
        "userId": "${userId}",
        "name": "Updated Name",
        "phone": "+1234567890"
      }
      """
    When user sends PUT request to "/users/profile"
    Then the response status code should be 200
    And the response JSON path "$.name" should equal "Updated Name"
Database Testing Example
gherkin# features/database/user-data.feature
@database @data-validation
Feature: User Data Validation

  Background:
    Given user connects to "USER_DB" database

  Scenario: Verify user creation
    When user executes query "INSERT INTO Users (Email, Name) VALUES ('test@example.com', 'Test User')"
    And user executes query "SELECT * FROM Users WHERE Email = 'test@example.com'"
    Then the query result should have 1 rows
    And the value in row 1 column "Name" should be "Test User"
    
  Scenario: Cleanup test data
    When user begins database transaction
    And user executes query "DELETE FROM Users WHERE Email LIKE 'test%'"
    And user commits database transaction
    Then user disconnects from database
Data-Driven Testing
gherkin# features/data-driven/login-variations.feature
@data-driven
Feature: Login with Multiple Users

  @DataProvider(source="test-data/users.xlsx", sheet="ValidUsers", executionFlag="Yes")
  Scenario Outline: Login with different user roles
    Given user navigates to "${BASE_URL}"
    When user types "<email>" in "Email input"
    And user types "<password>" in "Password input"
    And user clicks "Login button"
    Then "Dashboard" should be visible
    And user role should be "<role>"

    Examples:
      | email | password | role |
      | Data provided by @DataProvider |
Command Line Options
bash# Environment Selection
--env=dev|sit|qa|uat          # Select environment

# Test Selection
--feature=<path>              # Run specific feature(s)
--scenario=<name>             # Run specific scenario(s)
--tags=<expression>           # Run by tags

# Browser Options
--browser=chromium|firefox|webkit|msedge
--headed                      # Show browser
--headless                    # Hide browser (default)

# Execution Options
--parallel                    # Run in parallel
--workers=<number>           # Number of parallel workers
--retry=<number>             # Retry failed tests
--timeout=<ms>               # Test timeout
--dry-run                    # Parse without execution

# Debugging
--debug                      # Enable debug mode
--trace                      # Record trace
--video                      # Record video
--screenshot=on|off|only-on-failure

# Reporting
--report-format=html,pdf,excel,json,xml
--report-name=<name>         # Custom report name
--ado-upload                 # Upload to ADO

# Examples
npm test -- --env=qa --tags="@smoke and @critical" --parallel --workers=4
npm test -- --env=uat --feature=features/e2e/*.feature --browser=firefox --headed
npm test -- --env=dev --scenario="User can login" --debug --trace
Configuration
Environment Files
properties# config/environments/dev.env
BASE_URL=https://dev.example.com
API_BASE_URL=https://api-dev.example.com
DB_HOST=dev-db.example.com
DB_NAME=TestDB_Dev

# config/environments/qa.env
BASE_URL=https://qa.example.com
API_BASE_URL=https://api-qa.example.com
DB_HOST=qa-db.example.com
DB_NAME=TestDB_QA
Test Configuration
properties# config/test.config.env
DEFAULT_WAIT_TIME=5000
SCREENSHOT_ON_FAILURE=true
VIDEO_ON_FAILURE=false
PARALLEL_WORKERS=4
AI_CONFIDENCE_THRESHOLD=0.75
AI Features
Self-Healing Example
When a locator breaks:

Framework detects element not found
AI analyzes the page
Finds similar elements
Validates the match
Updates the locator
Continues test execution

Natural Language Element Identification
gherkin# AI understands these descriptions:
When user clicks "the blue submit button at the bottom"
When user types "John" in "the name field after email"
When user clicks "the third item in the product list"
Reporting
Reports are generated in reports/ directory with:

index.html - Main report dashboard
Detailed test results with steps and timings
Screenshots of failures
Performance metrics
Network logs
Custom branding with your colors

Troubleshooting
Element Not Found

Check element description in the step
Enable AI healing: aiEnabled: true
Add fallback locators
Review suggested locators in logs

Test Timeout

Increase timeout: --timeout=60000
Check network delays
Review wait conditions

Parallel Execution Issues

Reduce workers: --workers=2
Check resource usage
Enable test isolation

🎯 Best Practices
1. Test Design

Use descriptive scenario names
Apply consistent tags
Keep scenarios focused
Use Background for common steps

2. Element Definition

Provide clear descriptions
Enable AI for critical elements
Use multiple fallback locators
Test element stability

3. Data Management

Use environment variables
Encrypt sensitive data
Clean up test data
Use data providers for variations

4. Performance

Run tests in parallel
Use headless mode in CI
Optimize wait strategies
Monitor resource usage

🤝 Contributing
We welcome contributions! Please see our Contributing Guide for details.
📄 License
This project is licensed under the MIT License - see the LICENSE file for details.
🙏 Acknowledgments

Playwright team for the excellent automation library
The BDD community for Gherkin standards
All contributors who made this framework possible

📞 Support

Documentation: Wiki
Issues: GitHub Issues
Discussions: GitHub Discussions


<p align="center">
  Made with ❤️ by CS Test Automation Team
</p>
```
This completes all 9 remaining configuration files with full production-ready implementation. The package.json now includes ALL possible script combinations for running tests with different options as discussed in the blueprint.