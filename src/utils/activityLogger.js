import { ref, push, set, query, orderByChild, limitToLast, onValue, startAt, endAt } from 'firebase/database';
import { database } from '../lib/firebase';

/**
 * Log device activity when state changes
 * @param {string} environmentId - Environment ID
 * @param {string} deviceId - Device ID
 * @param {string} deviceName - Device name
 * @param {boolean} newState - New device state (true/false)
 * @param {string} userId - User who triggered the change (optional)
 * @param {string} roomId - Room ID where device is located
 */
export const logDeviceActivity = async (environmentId, deviceId, deviceName, newState, userId = null, roomId = null) => {
  try {
    const activityData = {
      timestamp: Date.now(),
      deviceId,
      deviceName,
      roomId,
      previousState: !newState, // Assuming this is the opposite of new state
      newState,
      userId,
      action: newState ? 'turned_on' : 'turned_off',
      date: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
      hour: new Date().getHours(),
      minute: new Date().getMinutes()
    };

    // Log to activity history
    const activityRef = ref(database, `environments/${environmentId}/activity`);
    await push(activityRef, activityData);

    // Update hourly aggregation for charts
    await updateHourlyActivity(environmentId, newState);
    
    console.log('Device activity logged successfully');
  } catch (error) {
    console.error('Error logging device activity:', error);
  }
};

/**
 * Update hourly activity aggregation
 * @param {string} environmentId - Environment ID
 * @param {boolean} newState - Device state
 */
const updateHourlyActivity = async (environmentId, newState) => {
  try {
    const now = new Date();
    const currentHour = now.getHours();
    const currentDate = now.toISOString().split('T')[0];
    
    const hourlyRef = ref(database, `environments/${environmentId}/hourlyActivity/${currentDate}/${currentHour}`);
    
    // Get current data or initialize
    const currentData = await new Promise((resolve) => {
      const unsubscribe = onValue(hourlyRef, (snapshot) => {
        resolve(snapshot.val());
        unsubscribe();
      });
    });

    const updatedData = {
      timestamp: Date.now(),
      hour: currentHour,
      date: currentDate,
      totalActions: (currentData?.totalActions || 0) + 1,
      onActions: (currentData?.onActions || 0) + (newState ? 1 : 0),
      offActions: (currentData?.offActions || 0) + (newState ? 0 : 1)
    };

    await set(hourlyRef, updatedData);
  } catch (error) {
    console.error('Error updating hourly activity:', error);
  }
};

/**
 * Get device activity for the last 24 hours
 * @param {string} environmentId - Environment ID
 * @returns {Array} Array of hourly activity data
 */
export const getHourlyActivity = async (environmentId) => {
  try {
    const now = new Date();
    const last24Hours = [];
    
    for (let i = 23; i >= 0; i--) {
      const targetTime = new Date(now.getTime() - (i * 60 * 60 * 1000));
      const targetDate = targetTime.toISOString().split('T')[0];
      const targetHour = targetTime.getHours();
      
      const hourlyRef = ref(database, `environments/${environmentId}/hourlyActivity/${targetDate}/${targetHour}`);
      
      try {
        const snapshot = await new Promise((resolve, reject) => {
          const unsubscribe = onValue(hourlyRef, (snapshot) => {
            resolve(snapshot);
            unsubscribe();
          }, reject);
        });
        
        const data = snapshot.val();
        last24Hours.push({
          hour: `${targetHour}:00`,
          timestamp: targetTime.getTime(),
          totalActions: data?.totalActions || 0,
          onActions: data?.onActions || 0,
          offActions: data?.offActions || 0
        });
      } catch (error) {
        // If no data exists for this hour, add zero values
        last24Hours.push({
          hour: `${targetHour}:00`,
          timestamp: targetTime.getTime(),
          totalActions: 0,
          onActions: 0,
          offActions: 0
        });
      }
    }
    
    return last24Hours;
  } catch (error) {
    console.error('Error getting hourly activity:', error);
    return [];
  }
};

/**
 * Get device activity for a specific date range
 * @param {string} environmentId - Environment ID
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Array} Array of activity data
 */
export const getActivityByDateRange = async (environmentId, startDate, endDate) => {
  try {
    const activityRef = ref(database, `environments/${environmentId}/activity`);
    const activityQuery = query(
      activityRef,
      orderByChild('timestamp'),
      startAt(startDate.getTime()),
      endAt(endDate.getTime())
    );
    
    const snapshot = await new Promise((resolve, reject) => {
      const unsubscribe = onValue(activityQuery, (snapshot) => {
        resolve(snapshot);
        unsubscribe();
      }, reject);
    });
    
    const activities = [];
    snapshot.forEach((childSnapshot) => {
      activities.push({
        id: childSnapshot.key,
        ...childSnapshot.val()
      });
    });
    
    return activities;
  } catch (error) {
    console.error('Error getting activity by date range:', error);
    return [];
  }
};

/**
 * Get most active devices
 * @param {string} environmentId - Environment ID
 * @param {number} limit - Number of devices to return
 * @returns {Array} Array of device activity summary
 */
export const getMostActiveDevices = async (environmentId, limit = 5) => {
  try {
    const activityRef = ref(database, `environments/${environmentId}/activity`);
    const recentQuery = query(activityRef, limitToLast(1000)); // Get last 1000 activities
    
    const snapshot = await new Promise((resolve, reject) => {
      const unsubscribe = onValue(recentQuery, (snapshot) => {
        resolve(snapshot);
        unsubscribe();
      }, reject);
    });
    
    const deviceActivity = {};
    
    snapshot.forEach((childSnapshot) => {
      const activity = childSnapshot.val();
      const deviceId = activity.deviceId;
      
      if (!deviceActivity[deviceId]) {
        deviceActivity[deviceId] = {
          deviceId,
          deviceName: activity.deviceName,
          totalActions: 0,
          onActions: 0,
          offActions: 0,
          lastActivity: activity.timestamp
        };
      }
      
      deviceActivity[deviceId].totalActions++;
      if (activity.newState) {
        deviceActivity[deviceId].onActions++;
      } else {
        deviceActivity[deviceId].offActions++;
      }
      
      if (activity.timestamp > deviceActivity[deviceId].lastActivity) {
        deviceActivity[deviceId].lastActivity = activity.timestamp;
      }
    });
    
    return Object.values(deviceActivity)
      .sort((a, b) => b.totalActions - a.totalActions)
      .slice(0, limit);
  } catch (error) {
    console.error('Error getting most active devices:', error);
    return [];
  }
};
