# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - future branch

## [1.5.1] - 2020-03-05
### Changed
- Now we can select which field contains in MC list (resolved the email column is not always the first column issue).
- DV summary changed to console.table function.

## [1.4.3] - 2019-11-13
### ADD
- Compare with our blacklist too
- Connect to CSE tools, after compared the list, we well handle cleaned scan and download the result for you.
- Connect to DataValidation API, right now we can also do DV in this tool right away. we will handle it for you.
- Able to connect accounts not in the Hi-iQ DB with `promot-customer-selector-manually.js` file.
### Changed
- Remove hard limitation for Email header name, now we can select which hader represent Email column.
- Change export data to email hash only, fixed the email order position issue.
### Fixed
- Downgrade dependency `async` to version 2.6.3 to fix `doUntil` bug.

## [1.0.0] - 2019-10-31
First release.
### ADD
Check provided contacts with Mailchimp list.
