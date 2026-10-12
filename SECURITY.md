# Security policy

## Reporting a vulnerability

Please report security issues privately, not in public issues or pull requests:

- Use GitHub's **[Report a vulnerability](https://github.com/Teamsocom/Teamso-MCP/security/advisories/new)**
  form (private vulnerability reporting), or
- e-mail **support@teamso.com** with "Security" in the subject.

Include the affected version, steps to reproduce and the impact. We acknowledge reports within three
business days and keep you updated until a fix is released.

## Scope

This repository contains the open-source MCP package. It talks to the Teamso API with a user's personal
access token and always acts with that user's permissions. Issues in the Teamso web application or API
can be reported the same way.

Never share a real access token (`tms_pat_...`) in an issue, pull request or log. If you exposed one,
revoke it immediately at https://teamso.com/dashboard/mcp-access.
