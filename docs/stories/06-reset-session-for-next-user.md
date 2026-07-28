# User Story: 6 - Reset Session for Next User

**As an** event operator,
**I want** the app to reset for the next user after a photo session completes,
**so that** the kiosk or device can serve attendees quickly without manual intervention.

## Acceptance Criteria

*   After the QR code screen is displayed, the app automatically resets to the camera view after a configurable timeout.
*   A manual **Done** / **Next User** button is available to immediately reset the session.
*   Resetting clears the previous user's photo from the screen and returns to the live camera view.
*   No previous user data remains visible on screen after reset.

## Notes

*   Auto-reset timer default can be short (e.g., 30 seconds); configurable per deployment.
*   Both auto-reset and manual reset should be available simultaneously for flexibility.
