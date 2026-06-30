# Security Policy

## Reporting a Vulnerability

DanteClicky takes security seriously. If you discover a security vulnerability, please email **richard.porras@realempanada.com** instead of using the public issue tracker.

### What to Include

- Description of the vulnerability and its impact
- Steps to reproduce (if applicable)
- Affected versions
- Any proposed fixes or mitigations

### Response Timeline

- **Initial response**: Within 24 hours
- **Update on progress**: Every 5 business days
- **Target fix release**: Within 14 days for critical vulnerabilities

## Security Features

### Data Protection

- **Encryption at Rest**: SQLCipher with AES-256 encryption
- **Encryption in Transit**: TLS 1.3 for all network communications
- **Field-Level Encryption**: ChaCha20 for sensitive fields (API keys, credentials)
- **OS-Level Key Protection**: DPAPI (Windows) for key storage

### Access Control

- **Incognito Mode**: Opt-in mode disables memory recording for sensitive sessions
- **Data Inventory**: Users can view and delete stored data at any time
- **Retention Policies**: Configurable automatic data expiration

### Dependency Security

- **cargo deny**: Regular audits for known vulnerabilities
- **Dependency Locking**: Cargo.lock ensures reproducible builds
- **Minimal Dependencies**: Prioritizes smaller dependency tree for maintainability

## Scope

Security reports are welcome for:

- Authentication/authorization bypass
- Data leakage or privacy violations
- Encryption/key management weaknesses
- Remote code execution
- Local privilege escalation
- Information disclosure

## Out of Scope

- Social engineering attacks
- Physical security issues
- DDoS or availability attacks
- Third-party dependency vulnerabilities (report to upstream maintainers)
