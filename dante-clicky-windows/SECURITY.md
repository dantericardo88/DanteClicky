# Security Policy

## Supported Versions

| Version | Supported          |
|---------|-------------------|
| 1.x     | ✅ Active Support  |
| 0.x     | ⚠️ Limited Support |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue in DanteClicky, please report it responsibly.

### How to Report

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please:

1. **Email us directly** at [security@danteforge.dev](mailto:security@danteforge.dev) with:
   - Description of the vulnerability
   - Steps to reproduce (if applicable)
   - Affected versions
   - Potential impact assessment

2. **Or use GitHub's Private Vulnerability Disclosure** (for GitHub-hosted projects):
   - Navigate to the Security tab
   - Click "Report a vulnerability"
   - Provide the same details as above

### Response Timeline

- **Acknowledgement**: We will acknowledge receipt within 48 hours
- **Assessment**: We will begin investigation and provide an initial assessment within 5 business days
- **Coordination**: For complex issues, we may request additional details or collaborate on a fix
- **Disclosure**: We follow a 90-day coordinated disclosure window by default

## Vulnerability Disclosure Policy

### Coordinated Disclosure

We follow a **coordinated disclosure model**:

1. You report the vulnerability to us privately
2. We confirm the issue and work on a fix
3. We coordinate with you on a disclosure timeline (default 90 days)
4. We release a patched version
5. A security advisory is published with proper credit to the reporter
6. The vulnerability is disclosed publicly

### Exceptions to 90-Day Window

- If a patch is available and released before 90 days, we disclose immediately
- If the vulnerability is already publicly known, we will disclose sooner
- Critical/CVSS 9+: We may request expedited disclosure (14-30 days) with your consent

## Security Best Practices

When using DanteClicky:

- **Keep your system updated**: Ensure your Windows OS and dependencies are current
- **Protect API keys**: Never commit API keys (OpenAI, Anthropic, etc.) to version control
- **Local execution**: Use the local Whisper model for sensitive audio transcription to avoid cloud transmission
- **User data**: All conversation history is stored locally on your machine by default
- **Dependencies**: We audit npm and Rust dependencies using `cargo-deny` and `npm audit`

## Out-of-Scope Vulnerabilities

The following are typically **out-of-scope** for our security program (but we still appreciate responsible disclosure):

- Third-party API vulnerabilities (OpenAI, Anthropic, AssemblyAI, ElevenLabs, etc.)
- Operating system or Tauri runtime vulnerabilities
- Social engineering, phishing, or user error
- Feature requests disguised as security issues
- Vulnerabilities in closed-source dependencies without proof of exploitation

## Security Monitoring

- **License compliance**: We use `cargo-deny` to audit and enforce allowed licenses
- **Dependency scanning**: All dependencies are reviewed for known vulnerabilities
- **Code review**: Pull requests require code review before merge
- **Signed releases**: Release artifacts are digitally signed

## Contact

- Security concerns: [security@danteforge.dev](mailto:security@danteforge.dev)
- General inquiries: [hello@danteforge.dev](mailto:hello@danteforge.dev)

---

Thank you for helping keep DanteClicky secure.
