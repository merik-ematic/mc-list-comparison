# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - future branch
### ADD
- Compare with our blacklist too
- Connect to DataValidation API, right now we can also do DV in this tool right away. we will handle it for you.
### Changed
- Remove hard limitation for Email header name, now we can select which hader represent Email column.
### Fixed
- Downgrade dependency `async` to version 2.6.3 to fix `doUntil` bug.

## [1.0.0] - 2019-10-31
First release.
### ADD
Check provided contacts with Mailchimp list.