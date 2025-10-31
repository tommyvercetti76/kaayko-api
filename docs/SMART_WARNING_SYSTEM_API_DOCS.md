# Smart Warning System API Documentation

## Overview
The Kaayko Smart Warning System provides intelligent, weather-dependent safety alerts based on actual current conditions and forecast trends. This replaces the previous hardcoded warning system with dynamic, contextual warnings that prioritize user safety.

## API Endpoints with Smart Warnings

### 1. paddleScore API
**Endpoint:** `GET /api/paddleScore`

**Response Format:**
```json
{
  "success": true,
  "paddleScore": {
    "rating": 3.5,
    "interpretation": "Good - Favorable conditions"
  },
  "warnings": {
    "hasWarnings": true,
    "count": 2,
    "messages": [
      "High UV exposure - use sun protection",
      "Strong winds - challenging for inexperienced paddlers"
    ],
    "warningType": "weather"
  },
  "conditions": { ... }
}
```

### 2. fastForecast API (Heatmap Data)
**Endpoint:** `GET /api/fastForecast`

**Response Format:**
```json
{
  "forecast": [
    {
      "date": "2025-10-22",
      "hourly": {
        "14": {
          "temperature": 28,
          "windSpeed": 22,
          "hasWarnings": true,
          "warnings": [
            "High UV exposure - use sun protection",
            "Strong winds - challenging for inexperienced paddlers"
          ],
          "prediction": { ... }
        }
      }
    }
  ]
}
```

### 3. paddlingOut API
**Endpoint:** `GET /api/paddlingOut`

**Response Format:**
```json
[
  {
    "id": "spot1",
    "title": "Lake Example",
    "paddleScore": {
      "rating": 4.0,
      "warnings": {
        "hasWarnings": false,
        "count": 0,
        "messages": [],
        "warningType": null
      }
    }
  }
]
```

## Warning Types and Triggers

### 🔥 Temperature Warnings
- **Extreme Heat** (≥35°C): "Extreme heat - risk of heat exhaustion"
- **High Heat** (≥30°C + low clouds + high UV): "High heat with intense sun exposure - stay hydrated"
- **Hot & Humid** (≥28°C + >80% humidity): "Hot and humid conditions - take frequent breaks"
- **Extreme Cold** (≤-5°C): "Extreme cold - hypothermia risk"
- **Freezing** (≤0°C): "Freezing conditions - ice formation possible"
- **Very Cold** (≤5°C): "Very cold air - dress warmly and limit exposure"

### 🌊 Water Temperature Warnings
- **Dangerous** (≤2°C): "Dangerously cold water - survival time minutes if immersed"
- **Cold Shock** (≤10°C): "Cold water shock risk - wear thermal protection"
- **Cool Water** (≤15°C): "Cool water - hypothermia possible with prolonged exposure"

### 💨 Wind Warnings
- **High Winds** (≥25mph): "High winds - small craft advisory conditions"
- **Strong Winds** (≥20mph): "Strong winds - challenging for inexperienced paddlers"
- **Gusty Conditions** (gusts >1.5x sustained): "Gusty conditions - sudden wind changes expected"

### ☀️ UV/Sun Warnings (Context-Aware)
- **Very High UV** (≥8 + ≤20% clouds): "Very high UV - sunburn risk within 15 minutes"
- **High UV** (≥6 + ≤40% clouds): "High UV exposure - use sun protection"

### 👁️ Visibility Warnings
- **Very Poor** (≤1km): "Very poor visibility - navigation hazardous"
- **Reduced** (≤3km): "Reduced visibility - stay close to shore"

### ⛈️ Forecast-Based Warnings
- **Thunderstorms**: "Thunderstorms approaching - seek shelter immediately"
- **Deteriorating Winds**: "Wind speeds increasing - conditions deteriorating"
- **Temperature Drop**: "Rapid temperature drop expected - dress in layers"
- **Heavy Rain**: "Rain expected - reduced visibility and comfort"

### 🌍 Location/Seasonal Warnings
- **Winter Northern** (>45°N + Nov-Mar + <5°C): "Winter conditions - daylight limited, inform others of plans"
- **Summer Heat** (<35°N + Jun-Aug + >30°C): "Summer heat - start early, avoid midday sun exposure"
- **Great Lakes** (specific region + winds >15mph): "Great Lakes conditions - waves build quickly with wind"

## Warning Priority System

Warnings are automatically prioritized by severity:

1. **Critical** (Red): extreme, dangerous, hypothermia, heat exhaustion, thunderstorms
2. **High** (Orange): high winds, strong winds, cold water shock, very poor visibility
3. **Medium** (Yellow): gusty, reduced visibility, rapid changes, deteriorating conditions
4. **Low** (Blue): informational warnings, general advisories

## Implementation Notes

### Smart Logic Features
- **Context-Aware UV**: Heat warnings only appear when actually sunny (low cloud cover)
- **Trend Analysis**: Forecasts next 6 hours for deteriorating conditions
- **Location Intelligence**: Great Lakes, seasonal, and latitude-specific warnings
- **Priority Limiting**: Maximum 3 warnings to avoid overwhelming users
- **Real-Time Updates**: Warnings change based on current conditions, not static rules

### Example Warning Scenarios

**Scenario 1: Sunny Miami Day**
- Conditions: 28°C, 20% clouds, UV index 8
- Warning: "High UV exposure - use sun protection"

**Scenario 2: Cloudy Cool Day**  
- Conditions: 25°C, 90% clouds, UV index 3
- Warning: None (no fake heat warnings!)

**Scenario 3: Windy Great Lakes**
- Conditions: Great Lakes, 18mph winds
- Warning: "Great Lakes conditions - waves build quickly with wind"

**Scenario 4: Winter Conditions**
- Conditions: Minnesota, December, 2°C
- Warning: "Winter conditions - daylight limited, inform others of plans"

## Integration Guide

### Frontend Implementation
```javascript
// Check for warnings
if (data.warnings && data.warnings.hasWarnings) {
  displayWarnings(data.warnings.messages);
}

// Warning badge display
const warningCount = data.warnings ? data.warnings.count : 0;
```

### iOS Implementation
```swift
// Access warnings from POCard
if card.hasWarnings {
  ForEach(card.warningMessages, id: \.self) { warning in
    WarningView(message: warning)
  }
}
```

## Testing Endpoints

```bash
# Test UV warnings (Miami midday)
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/fastForecast?lat=25.7617&lng=-80.1918" | jq '.forecast[0].hourly["14"].warnings'

# Test current conditions
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/paddleScore?lat=46.205&lng=-84.447" | jq '.warnings'

# Test paddling spots
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/paddlingOut" | jq '.[0].paddleScore.warnings'
```

## Migration from Legacy System

### Before (Hardcoded)
```swift
case .good: return "Good conditions - Heat caution advised"  // Always showed fake warning
```

### After (Smart)
```swift
// Warnings only appear when actual weather conditions warrant them
if card.hasWarnings {
  // Display real warnings from API
  ForEach(card.warningMessages) { warning in
    SmartWarningView(message: warning)
  }
}
```

The smart warning system ensures **"HIGHLY ACCURATE"** and weather-dependent warnings as requested, eliminating fake warnings when conditions don't warrant them.