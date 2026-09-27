# MakeMyLabs Transaction Hub

Build a new MakeMyLabs Internal Transaction Platform as an enterprise-grade internal operations and business tracking system.

PLATFORM OBJECTIVE

The platform must act as the official single source of truth for all MakeMyLabs transaction tracking, lab tracking, cloud classification, revenue tracking, reporting, and future business analysis.

The new platform must be built around one master transaction entry flow, one central master transaction table, and automatically generated repository views for Public Cloud and Private Cloud.

Do not build separate data-entry forms or separate source tables for AWS, Azure, GCP, or Private Cloud.

CORE PRINCIPLE

Every transaction must:

1. Be captured through one common Master ADR Entry Form.

2. Be validated before submission.

3. Be stored in one central master transaction table.

4. Be automatically classified into Public Cloud or Private Cloud.

5. Be immediately available for dashboarding, filtering, searching, reporting, and Excel export.

PRIMARY DATA MODEL

Create the following core entities:

1. transactions

   This is the central source of truth for every transaction.

   Required fields:

   - id

   - potential_id

   - month

   - year

   - customer_id

   - customer_name

   - lab_name

   - lab_type

   - repository_type

   - cloud_provider

   - line_of_business

   - start_date

   - end_date

   - total_users

   - selling_cost

   - created_by

   - created_at

   - updated_by

   - updated_at

   - is_deleted

2. customers

   Stores standardized customer records.

   Required fields:

   - id

   - customer_name

   - normalized_name

   - is_active

   - created_at

   - updated_at

3. transaction_activity_log

   Tracks all transaction changes.

   Required fields:

   - id

   - transaction_id

   - action

   - field_name

   - old_value

   - new_value

   - changed_by

   - changed_at

4. profiles / users

   Stores internal users and roles.

5. config_master

   Stores configurable dropdown values such as lab type, cloud provider, line of business, and statuses.

FUTURE-READY TABLES

Design the architecture so these modules can be added later without redesign:

- P&L Tracking

- Cloud Cost Tracking

- Customer Profitability

- Revenue Forecasting

- Public Cloud Consumption Analysis

- Private Cloud Utilization Analysis

- Business Performance Dashboards

- Executive Reporting

- Vendor Cost Comparison

- Margin Analysis

MASTER ADR ENTRY FORM

Create one primary data entry screen called Master ADR Entry.

There must be no separate forms for:

- AWS

- Azure

- GCP

- Private Cloud

All records must originate from the Master ADR Entry Form.

Mandatory fields:

- Potential ID

- Month

- Year

- Customer Name

- Lab Name

- Lab Type

- Cloud Provider, only when Lab Type is Public Cloud

- Line of Business

- Start Date

- End Date

- Total Number of Users

- Selling Cost

Validation rules:

- Potential ID must be unique.

- End Date cannot be earlier than Start Date.

- Total Number of Users must be greater than zero.

- Selling Cost must be numeric.

- Blank submissions must not be allowed.

- Customer Name is required.

- Lab Name is required.

- Lab Type is required.

- Line of Business is required.

- If Lab Type is Public Cloud, Cloud Provider is mandatory and must be one of AWS, Azure, or GCP.

- If Lab Type is Private Cloud, Cloud Provider must be automatically set to MakeMyLabs Private Cloud.

- All validation must happen before saving.

CLOUD CLASSIFICATION LOGIC

The system must automatically classify records based on Lab Type.

If Lab Type = Public Cloud:

- repository_type = public_cloud

- cloud_provider must be one of:

  - AWS

  - Azure

  - GCP

- The record must appear in the Public Cloud Repository.

If Lab Type = Private Cloud:

- repository_type = private_cloud

- cloud_provider = MakeMyLabs Private Cloud

- The record must appear in the Private Cloud Repository.

Users should never manually move records between repositories. Repository assignment must happen automatically on submission and update.

CUSTOMER MANAGEMENT

Customer Name must be maintained as a master list.

Users should be able to:

- Select an existing customer.

- Create a new customer from the Master ADR Entry Form.

Rules:

- New customers must automatically become available in future entries.

- Customer names must remain standardized.

- Duplicate customer creation must be prevented using case-insensitive normalized matching.

- Customers should support active/inactive status.

- Customer module should show customer name, status, transaction count, total users, and total revenue.

PUBLIC CLOUD REPOSITORY

Create a Public Cloud Repository view that displays all records where repository_type = public_cloud.

Supported providers:

- AWS

- Azure

- GCP

Filters:

- Month

- Year

- Customer Name

- Cloud Provider

- Line of Business

- Date Range

Displayed columns:

- Potential ID

- Month

- Year

- Customer Name

- Lab Name

- Cloud Provider

- Line of Business

- Start Date

- End Date

- Total Users

- Selling Cost

- Created By

- Last Updated

Features:

- Instant filtering

- Sortable columns

- Pagination

- Column visibility

- Excel export respecting active filters

- Open transaction detail

- View activity history

PRIVATE CLOUD REPOSITORY

Create a Private Cloud Repository view that displays all records where repository_type = private_cloud.

Filters:

- Month

- Year

- Customer Name

- Line of Business

- Date Range

Displayed columns:

- Potential ID

- Month

- Year

- Customer Name

- Lab Name

- Line of Business

- Start Date

- End Date

- Total Users

- Selling Cost

- Created By

- Last Updated

Features:

- Instant filtering

- Sortable columns

- Pagination

- Column visibility

- Excel export respecting active filters

- Open transaction detail

- View activity history

DASHBOARD REQUIREMENTS

Create a management dashboard that refreshes automatically when new transactions are created or updated.

KPI cards:

- Total Transactions

- Total Public Cloud Transactions

- Total Private Cloud Transactions

- Total Users

- Total Revenue

- Average Selling Cost

- Current Month Revenue

- Current Month Users

Charts:

- Transactions by Month

- Public Cloud vs Private Cloud Split

- Revenue by Month

- Provider Split: AWS, Azure, GCP

- Top Customers by Revenue

- Top Customers by Users

- Line of Business Split

Dashboard filters:

- Month

- Year

- Customer Name

- Repository Type

- Cloud Provider

- Line of Business

- Date Range

SEARCH AND FILTERING

Create global search functionality.

Users must be able to search by:

- Potential ID

- Customer Name

- Lab Name

- Cloud Provider

- Line of Business

Search results should show:

- Potential ID

- Customer Name

- Lab Name

- Repository Type

- Cloud Provider

- Month

- Year

- Total Users

- Selling Cost

- Quick action to open transaction detail

Filtering must be available throughout the application and must update results instantly.

EXPORT FUNCTIONALITY

Users must be able to export data to Excel.

Exports must respect all active filters.

Exportable areas:

- Public Cloud Repository

- Private Cloud Repository

- All Transactions

- Dashboard Summary

- Customer-level Summary

Each export should include:

- Generated by

- Generated date/time

- Applied filters

- Record count

USER ROLES AND ACCESS

Create role-based access.

Roles:

- Admin

- Leadership

- Finance

- Ops Lead

- Ops User

- Viewer

Access rules:

- Admin: full access, user management, config, delete/restore, all reports.

- Leadership: dashboards, reports, read-only transaction access.

- Finance: revenue, exports, cloud cost, profitability, reports.

- Ops Lead: create/edit transactions, repositories, dashboards.

- Ops User: create/edit own or assigned records.

- Viewer: read-only limited access.

Important:

- Role checks must exist in both frontend and backend/database rules.

- Do not rely only on frontend route protection.

- Use secure backend/database-level access control.

AUDIT AND DATA INTEGRITY

Every transaction must track:

- Created by

- Created at

- Updated by

- Updated at

- Deleted flag

- Classification reason

- Validation status

Every important change must create an activity log entry:

- Field changed

- Old value

- New value

- Changed by

- Changed at

Use soft delete instead of hard delete.

TECHNICAL REQUIREMENTS

The app must be:

- Fast

- Responsive

- Enterprise-grade

- Mobile-friendly

- Tablet-friendly

- Desktop-friendly

- Easy for business users to understand

- Minimal training required

Use a clean, operational UI. Avoid marketing-style landing pages. The first screen after login should be the working dashboard.

Navigation should include:

- Dashboard

- Master ADR Entry

- All Transactions

- Public Cloud Repository

- Private Cloud Repository

- Customers

- Reports

- Admin Settings

SECURITY REQUIREMENTS

Avoid public unrestricted database policies.

Do not allow anonymous users to insert, update, delete, or read internal transaction data.

Do not expose service-role actions without authentication and role verification.

Use secure validation before writing data.

Use soft delete and audit logs.

Testing should cover:

- Master form validation

- Unique Potential ID enforcement

- Public Cloud classification

- Private Cloud classification

- Customer creation and duplicate prevention

- Repository filtering

- Dashboard KPI accuracy

- Excel export respecting filters

- Role-based access

- Audit log creation

BUILD PHASES

Phase 1: Foundation

- Database schema

- Authentication and role model

- Master ADR Entry Form

- Customer master

- Validation engine

- Public/Private auto-classification

- Basic repository views

Phase 2: Dashboard and Reporting

- KPI dashboard

- Charts

- Global filters

- Excel export

- Global search

- Customer-level summary

Phase 3: Governance and Security

- Backend/database access rules

- Audit log

- Soft delete

- Admin user management

- Configurable dropdowns

- Production-safe file handling

Phase 4: Finance Readiness

- Cloud cost tables

- Margin fields

- Customer profitability base

- Revenue forecasting base

- Finance reports

Phase 5: Enterprise Hardening

- End-to-end tests

- Data migration tools

- Monitoring

- Error logs

- Backup/restore process

- UAT checklist

- Go-live checklist

KEY IMPLEMENTATION DECISION

Do not rebuild the old Solutions vs Delivery split as the foundation.

The correct new flow is:

Master ADR Entry

-> transactions table

-> automatic Public Cloud / Private Cloud classification

-> repository views

-> dashboard

-> reports

-> export

-> future finance modules

The system must be designed as a scalable internal MakeMyLabs business transaction management platform.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://mml-internal.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/cf3e24da-03ad-433c-be90-bd7ad878f932).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
