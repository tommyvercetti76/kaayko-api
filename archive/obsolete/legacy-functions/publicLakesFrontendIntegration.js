// Frontend integration for nearby public lakes
// Add this to your existing kaayko_apiClient.js

class PublicLakesAPI {
    constructor(firebaseApp) {
        this.functions = firebase.functions(firebaseApp);
        this.nearbyPublicLakes = this.functions.httpsCallable('nearbyPublicLakes');
    }

    /**
     * Find paddleable lakes on public lands near a location
     * @param {number} latitude - Center latitude
     * @param {number} longitude - Center longitude  
     * @param {number} radiusMiles - Search radius in miles (default: 25)
     * @param {number} limit - Maximum results (default: 20)
     * @param {number} publicDistanceMiles - Max distance to public land (default: 0.3)
     * @returns {Promise<Object>} API response with lakes array
     */
    async findNearbyPublicLakes(latitude, longitude, options = {}) {
        const {
            radiusMiles = 25,
            limit = 20,
            publicDistanceMiles = 0.3
        } = options;

        try {
            console.log(`🏞️ Searching for public lakes near ${latitude}, ${longitude}`);
            
            const result = await this.nearbyPublicLakes({
                latitude,
                longitude,
                radiusMiles,
                limit,
                publicDistanceMiles
            });

            if (result.data.success) {
                console.log(`✅ Found ${result.data.count} public lakes`);
                return result.data;
            } else {
                throw new Error('API returned unsuccessful response');
            }

        } catch (error) {
            console.error('❌ Failed to fetch public lakes:', error);
            throw error;
        }
    }

    /**
     * Get lakes formatted for map display
     * @param {number} latitude 
     * @param {number} longitude 
     * @param {Object} options 
     * @returns {Promise<Array>} Array of lake objects with map markers
     */
    async getLakesForMap(latitude, longitude, options = {}) {
        const response = await this.findNearbyPublicLakes(latitude, longitude, options);
        
        return response.lakes.map(lake => ({
            id: lake.id,
            name: lake.name,
            position: {
                lat: lake.coordinates.latitude,
                lng: lake.coordinates.longitude
            },
            type: lake.type,
            distance: `${lake.distanceMiles} mi`,
            publicLand: lake.publicLand.name,
            publicLandType: lake.publicLand.type,
            access: lake.access,
            infoWindow: {
                title: lake.name,
                content: `
                    <div class="lake-info">
                        <h3>${lake.name}</h3>
                        <p><strong>Type:</strong> ${lake.type}</p>
                        <p><strong>Distance:</strong> ${lake.distanceMiles} miles</p>
                        <p><strong>Public Land:</strong> ${lake.publicLand.name}</p>
                        <p><strong>Land Type:</strong> ${lake.publicLand.type}</p>
                        <p><strong>Access:</strong> ${lake.access}</p>
                        ${lake.website ? `<p><a href="${lake.website}" target="_blank">More Info</a></p>` : ''}
                    </div>
                `
            }
        }));
    }
}

// Add to existing KaaykoAPI class
class KaaykoAPI {
    constructor(firebaseApp) {
        // ... existing constructor code ...
        this.publicLakes = new PublicLakesAPI(firebaseApp);
    }

    // ... existing methods ...
}

// Usage examples for frontend integration:

/**
 * Example 1: Display public lakes on map
 */
async function displayPublicLakesOnMap(map, latitude, longitude) {
    try {
        const lakesData = await kaaykoAPI.publicLakes.getLakesForMap(latitude, longitude, {
            radiusMiles: 30,
            limit: 15
        });

        lakesData.forEach(lake => {
            const marker = new google.maps.Marker({
                position: lake.position,
                map: map,
                title: lake.name,
                icon: {
                    url: lake.type === 'Reservoir' ? '/assets/reservoir-icon.png' : '/assets/lake-icon.png',
                    scaledSize: new google.maps.Size(32, 32)
                }
            });

            const infoWindow = new google.maps.InfoWindow({
                content: lake.infoWindow.content
            });

            marker.addListener('click', () => {
                infoWindow.open(map, marker);
            });
        });

        console.log(`Added ${lakesData.length} public lakes to map`);
    } catch (error) {
        console.error('Failed to display public lakes:', error);
    }
}

/**
 * Example 2: Create lakes list for UI
 */
async function createPublicLakesList(latitude, longitude, containerId) {
    try {
        const response = await kaaykoAPI.publicLakes.findNearbyPublicLakes(latitude, longitude);
        const container = document.getElementById(containerId);
        
        if (response.lakes.length === 0) {
            container.innerHTML = '<p>No public lakes found in this area.</p>';
            return;
        }

        const listHTML = `
            <div class="public-lakes-header">
                <h3>🏞️ Paddleable Lakes on Public Lands</h3>
                <p>Found ${response.count} lakes within ${response.location.radiusMiles} miles</p>
            </div>
            <div class="lakes-list">
                ${response.lakes.map(lake => `
                    <div class="lake-card" data-lake-id="${lake.id}">
                        <div class="lake-header">
                            <h4>${lake.name}</h4>
                            <span class="lake-type">${lake.type}</span>
                        </div>
                        <div class="lake-details">
                            <p><strong>Distance:</strong> ${lake.distanceMiles} miles</p>
                            <p><strong>Public Land:</strong> ${lake.publicLand.name}</p>
                            <p><strong>Access:</strong> ${lake.access}</p>
                        </div>
                        <div class="lake-actions">
                            <button onclick="viewOnMap(${lake.coordinates.latitude}, ${lake.coordinates.longitude})">
                                View on Map
                            </button>
                            ${lake.website ? `<a href="${lake.website}" target="_blank">More Info</a>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        container.innerHTML = listHTML;
    } catch (error) {
        console.error('Failed to create lakes list:', error);
        document.getElementById(containerId).innerHTML = 
            '<p class="error">Failed to load public lakes. Please try again.</p>';
    }
}

/**
 * Example 3: Integration with existing location search
 */
async function handleLocationSearchWithLakes(searchQuery) {
    try {
        // Use existing geocoding to get coordinates
        const location = await geocodeLocation(searchQuery);
        
        // Get weather data (existing functionality)
        const weatherData = await kaaykoAPI.getWeatherData(location.lat, location.lng);
        
        // Get nearby public lakes (new functionality)
        const lakesData = await kaaykoAPI.publicLakes.findNearbyPublicLakes(location.lat, location.lng, {
            radiusMiles: 25,
            limit: 10
        });

        // Display combined results
        displayLocationResults({
            location: location,
            weather: weatherData,
            publicLakes: lakesData.lakes
        });

    } catch (error) {
        console.error('Location search with lakes failed:', error);
    }
}

// CSS for styling (add to your existing stylesheets)
const publicLakesCSS = `
.lake-card {
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    padding: 16px;
    margin-bottom: 12px;
    border-left: 4px solid #2196F3;
}

.lake-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
}

.lake-header h4 {
    margin: 0;
    color: #1976D2;
}

.lake-type {
    background: #E3F2FD;
    color: #1976D2;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: bold;
}

.lake-details {
    margin: 8px 0;
    font-size: 14px;
    color: #666;
}

.lake-actions {
    margin-top: 12px;
    display: flex;
    gap: 8px;
}

.lake-actions button {
    background: #2196F3;
    color: white;
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
}

.lake-actions a {
    color: #2196F3;
    text-decoration: none;
    padding: 6px 12px;
    font-size: 12px;
}

.public-lakes-header {
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 2px solid #E0E0E0;
}
`;
