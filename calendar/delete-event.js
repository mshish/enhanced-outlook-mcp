const config = require('../config');
const logger = require('../utils/logger');
const { createGraphClient } = require('../utils/graph-api-adapter');
const { listUsers } = require('../auth/token-manager');

/**
 * Delete a calendar event
 * @param {Object} params - Tool parameters
 * @returns {Promise<Object>} - Deletion result
 */
async function deleteEventHandler(params = {}) {
  let userId = params.userId;
  if (!userId) {
    const users = await listUsers();
    if (users.length === 0) {
      return formatMcpResponse({
        status: 'error',
        message: 'No authenticated users found. Please authenticate first.'
      });
    }
    userId = users.length === 1 ? users[0] : params.userId;
    if (!userId) {
      return formatMcpResponse({
        status: 'error',
        message: 'Multiple users found. Please specify userId parameter.'
      });
    }
  }
  const eventId = params.eventId;
  
  if (!eventId) {
    return formatMcpResponse({
      status: 'error',
      message: 'Event ID is required'
    });
  }
  
  try {
    logger.info(`Deleting calendar event ${eventId} for user ${userId}`);
    
    const graphClient = await createGraphClient(userId);
    
    // Delete the event
    await graphClient.delete(`/me/events/${eventId}`);
    
    return formatMcpResponse({
      status: 'success',
      message: 'Event deleted successfully',
      eventId
    });
  } catch (error) {
    logger.error(`Error deleting calendar event: ${error.message}`);
    
    return formatMcpResponse({
      status: 'error',
      message: `Failed to delete calendar event: ${error.message}`
    });
  }
}

/**
 * Cancel a calendar event
 * @param {Object} params - Tool parameters
 * @returns {Promise<Object>} - Cancellation result
 */
async function cancelEventHandler(params = {}) {
  let userId = params.userId;
  if (!userId) {
    const users = await listUsers();
    if (users.length === 0) {
      return formatMcpResponse({
        status: 'error',
        message: 'No authenticated users found. Please authenticate first.'
      });
    }
    userId = users.length === 1 ? users[0] : params.userId;
    if (!userId) {
      return formatMcpResponse({
        status: 'error',
        message: 'Multiple users found. Please specify userId parameter.'
      });
    }
  }
  const eventId = params.eventId;
  
  if (!eventId) {
    return formatMcpResponse({
      status: 'error',
      message: 'Event ID is required'
    });
  }
  
  try {
    logger.info(`Cancelling calendar event ${eventId} for user ${userId}`);
    
    const graphClient = await createGraphClient(userId);
    
    // Create cancellation data
    const cancellationData = {
      comment: params.comment || 'Event cancelled'
    };
    
    // Cancel the event (sends cancellation notifications to attendees)
    await graphClient.post(`/me/events/${eventId}/cancel`, cancellationData);
    
    return formatMcpResponse({
      status: 'success',
      message: 'Event cancelled successfully',
      eventId
    });
  } catch (error) {
    logger.error(`Error cancelling calendar event: ${error.message}`);
    
    return formatMcpResponse({
      status: 'error',
      message: `Failed to cancel calendar event: ${error.message}`
    });
  }
}

/**
 * Find available meeting times
 * @param {Object} params - Tool parameters
 * @returns {Promise<Object>} - Available meeting times
 */
async function findMeetingTimesHandler(params = {}) {
  let userId = params.userId;
  if (!userId) {
    const users = await listUsers();
    userId = users.length === 1 ? users[0] : 'default';
  }
  
  try {
    logger.info(`Finding available meeting times for user ${userId}`);
    
    const graphClient = await createGraphClient(userId);
    
    // Build meeting time suggestions request
    const findTimesRequest = {
      attendees: formatAttendees(params.attendees),
      timeConstraint: {
        timeSlots: [
          {
            start: {
              dateTime: params.startDateTime || new Date().toISOString(),
              timeZone: params.timeZone || 'UTC'
            },
            end: {
              dateTime: params.endDateTime || getDefaultEndDateTime(),
              timeZone: params.timeZone || 'UTC'
            }
          }
        ]
      },
      meetingDuration: params.duration || 'PT30M', // ISO8601 duration format
      returnSuggestionReasons: true,
      minimumAttendeePercentage: params.minimumAttendeePercentage || 100
    };
    
    // If locations are provided
    if (params.locations && Array.isArray(params.locations)) {
      findTimesRequest.locationConstraint = {
        isRequired: params.isLocationRequired === true,
        suggestLocation: params.suggestLocation === true,
        locations: params.locations.map(location => ({
          displayName: typeof location === 'string' ? location : location.displayName || location.name,
          locationEmailAddress: typeof location === 'object' ? location.email : undefined
        }))
      };
    }
    
    // Find meeting times
    const response = await graphClient.post('/me/findMeetingTimes', findTimesRequest);
    
    return formatMcpResponse({
      status: 'success',
      meetingTimeSuggestions: response.meetingTimeSuggestions || [],
      emptySuggestionsReason: response.emptySuggestionsReason
    });
  } catch (error) {
    logger.error(`Error finding meeting times: ${error.message}`);
    
    return formatMcpResponse({
      status: 'error',
      message: `Failed to find meeting times: ${error.message}`
    });
  }
}

/**
 * Get default end date time (7 days from now)
 * @returns {string} - ISO string for 7 days from now
 */
function getDefaultEndDateTime() {
  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return sevenDaysLater.toISOString();
}

/**
 * Format attendees for API
 * @param {Array|string|Object} attendees - Attendees in various formats
 * @returns {Array} - Formatted attendees
 */
function formatAttendees(attendees) {
  if (!attendees) {
    return [];
  }
  
  // Handle string with comma or semicolon separators
  if (typeof attendees === 'string') {
    attendees = attendees.split(/[,;]/).map(a => a.trim()).filter(Boolean);
  }
  
  // Ensure it's an array
  if (!Array.isArray(attendees)) {
    attendees = [attendees];
  }
  
  // Format each attendee
  return attendees.map(attendee => {
    // If already in the correct format
    if (typeof attendee === 'object' && attendee.emailAddress) {
      return attendee;
    }
    
    // Handle string in format "Name <email@example.com>"
    if (typeof attendee === 'string') {
      const match = attendee.match(/^(.*?)\s*<([^>]+)>$/);
      if (match) {
        return {
          emailAddress: {
            name: match[1].trim(),
            address: match[2].trim()
          },
          type: 'required'
        };
      }
      
      // Just an email address
      return {
        emailAddress: {
          address: attendee.trim()
        },
        type: 'required'
      };
    }
    
    // Handle object with name and email properties
    if (typeof attendee === 'object' && attendee.email) {
      return {
        emailAddress: {
          name: attendee.name || '',
          address: attendee.email
        },
        type: attendee.type || 'required'
      };
    }
    
    // Default case
    return {
      emailAddress: {
        address: String(attendee)
      },
      type: 'required'
    };
  });
}

/**
 * Format response for MCP
 * @param {Object} data - Response data
 * @returns {Object} - MCP formatted response
 */
function formatMcpResponse(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data)
      }
    ]
  };
}

module.exports = {
  deleteEventHandler,
  cancelEventHandler,
  findMeetingTimesHandler
};