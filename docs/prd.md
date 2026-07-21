# OpenClaw Architecture

## Overview

OpenClaw is a modular automation platform that coordinates discovery, data management, workflow execution, messaging integrations, and operator control from a web dashboard and Telegram bot.

---

## High-Level Architecture

```text
                +------------------+
                |   Data Sources   |
                +--------+---------+
                         |
         +---------------+---------------+
         |                               |
         v                               v
+-------------------+         +-------------------+
| Source Connector  |         | Source Connector  |
| Platform A        |         | Platform B        |
+---------+---------+         +---------+---------+
          \                         /
           \                       /
            +---------------------+
            |  Filtering Engine   |
            +----------+----------+
                       |
                       v
            +----------------------+
            | Duplicate Detection  |
            +----------+-----------+
                       |
                       v
            +----------------------+
            | PostgreSQL Database  |
            +----------+-----------+
                       |
         +-------------+-------------+
         |                           |
         v                           v
+-------------------+       +------------------+
| Workflow Engine   |       | Analytics Engine |
+---------+---------+       +------------------+
          |
          v
+-------------------+
| Messaging Adapter |
+---------+---------+
          |
          v
+-------------------+
| Telegram Bot      |
+-------------------+

          ^
          |
+-------------------+
| Web Dashboard     |
+-------------------+
```

---

## Core Components

### Source Connectors

Responsible for collecting publicly available information from supported platforms.

Responsibilities

- Execute searches
- Apply configurable filters
- Normalize collected data
- Forward results to the processing pipeline

---

### Filtering Engine

Evaluates records against configurable business rules.

Example filters

- Keywords
- Categories
- Geographic region
- Public profile attributes

---

### Duplicate Detection

Prevents processing the same profile multiple times.

Checks include

- Platform identifier
- Username
- Previously processed records

---

### Database

Stores application data.

Tables

- Profiles
- Activities
- Messages
- Settings
- Workflow Logs
- Platform Accounts

---

### Workflow Engine

Coordinates processing jobs.

Responsibilities

- Queue management
- Scheduling
- Retry handling
- Rate limiting
- Logging

---

### Messaging Layer

Provides an abstraction for messaging integrations.

Capabilities

- Template management
- Delivery tracking
- Retry logic
- Error handling

---

### Telegram Bot

Remote administration interface.

Commands

- Start
- Stop
- Pause
- Resume
- View statistics
- Manage accounts
- View logs
- Configure settings

---

### Web Dashboard

Browser-based management console.

Features

- Overview dashboard
- Workflow status
- Activity logs
- Settings
- Analytics
- User management

---

## Database Schema

Profiles

```sql
id
platform
external_id
username
display_name
status
created_at
updated_at
```

Activities

```sql
id
profile_id
event
details
created_at
```

Settings

```sql
key
value
updated_at
```

Workflow Logs

```sql
id
worker
status
message
created_at
```

---

## Processing Pipeline

```text
Search
      ↓
Filter
      ↓
Normalize
      ↓
Duplicate Check
      ↓
Save Database
      ↓
Queue Job
      ↓
Execute Workflow
      ↓
Log Results
      ↓
Analytics
```

---

## Control Layer

### Telegram

- Start workflow
- Stop workflow
- Pause queue
- Resume queue
- View metrics
- Notifications

### Dashboard

- Live monitoring
- Queue status
- Database browser
- Configuration
- Reports

---

## Technology Stack

Backend

- Node.js
- Express

Database

- PostgreSQL

Queue

- BullMQ
- Redis

Automation

- Puppeteer

Dashboard

- React
- Tailwind CSS

Messaging

- Telegram Bot API

Deployment

- Docker
- Nginx
- Ubuntu Server

---

## Future Improvements

- Plugin architecture
- Multi-tenant support
- Audit logging
- Advanced analytics
- AI-assisted workflow recommendations
- Horizontal worker scaling

---

## Version

OpenClaw Architecture v1.0