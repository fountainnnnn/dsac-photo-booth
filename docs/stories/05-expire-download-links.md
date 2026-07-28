# User Story: 5 - Expire Download Links Automatically

**As an** event operator,
**I want** generated photo download links to expire automatically after a limited time,
**so that** storage is managed efficiently and photos are not hosted indefinitely.

## Acceptance Criteria

*   Each generated image is stored with a creation timestamp and a configurable expiry duration.
*   The download link remains active for a limited window (default: 24 hours).
*   After expiry, accessing the link returns an appropriate message (e.g., "This link has expired").
*   Expired images and their associated data are cleaned up automatically.
*   The expiry duration is configurable by the event operator.

## Notes

*   Sarah suggested a retention window of a few hours to one day.
*   Default can be set conservatively (e.g., 24 hours) and tuned per event.
