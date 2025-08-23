#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
improved_overpass_lakes.py

Enhanced Overpass API implementation for finding paddleable lakes on public lands.
This version addresses common Overpass query issues and provides better filtering.
"""

import argparse
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

# ----------------------- Config -----------------------

OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter", 
    "https://lz4.overpass-api.de/api/interpreter"
]

USER_AGENT = "Kaayko-Paddling-Lakes/1.0 (paddling app)"
HTTP_TIMEOUT = 60
QUERY_TIMEOUT = 180

# ----------------------- Utilities -----------------------

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in miles between two points."""
    R = 3959  # Earth's radius in miles
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2) 
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    
    a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def meters_to_miles(meters: float) -> float:
    return meters * 0.000621371

def miles_to_meters(miles: float) -> int:
    return int(miles * 1609.34)

# ----------------------- Overpass Queries -----------------------

def build_water_query(lat: float, lon: float, radius_meters: int) -> str:
    """
    Build Overpass query for water bodies suitable for paddling.
    Uses bbox instead of around for better reliability.
    """
    bbox_size = radius_meters / 111000  # Rough degrees conversion
    south = lat - bbox_size
    north = lat + bbox_size  
    west = lon - bbox_size
    east = lon + bbox_size
    
    return f"""[out:json][timeout:{QUERY_TIMEOUT}];
(
  // Natural water bodies - ways
  way({south},{west},{north},{east})
    ["natural"="water"]
    ["name"]
    ["intermittent"!="yes"];
  
  // Natural water bodies - relations  
  relation({south},{west},{north},{east})
    ["natural"="water"] 
    ["name"]
    ["intermittent"!="yes"];
    
  // Specific lake/reservoir tags
  way({south},{west},{north},{east})
    ["water"~"^(lake|reservoir)$"]
    ["name"];
    
  relation({south},{west},{north},{east})
    ["water"~"^(lake|reservoir)$"]
    ["name"];
    
  // Place nodes for lakes
  node({south},{west},{north},{east})
    ["place"~"^(lake|reservoir)$"]
    ["name"];
);
out center meta;"""

def build_public_lands_query(lat: float, lon: float, radius_meters: int) -> str:
    """
    Build Overpass query for public lands where water access might be allowed.
    """
    bbox_size = radius_meters / 111000
    south = lat - bbox_size
    north = lat + bbox_size
    west = lon - bbox_size  
    east = lon + bbox_size
    
    return f"""[out:json][timeout:{QUERY_TIMEOUT}];
(
  // Protected areas and parks
  way({south},{west},{north},{east})
    ["boundary"="protected_area"];
  relation({south},{west},{north},{east})
    ["boundary"="protected_area"];
    
  way({south},{west},{north},{east})
    ["boundary"="national_park"];
  relation({south},{west},{north},{east})
    ["boundary"="national_park"];
    
  // State and local parks
  way({south},{west},{north},{east})
    ["leisure"="park"];
  relation({south},{west},{north},{east})
    ["leisure"="park"];
    
  // Nature reserves
  way({south},{west},{north},{east})
    ["leisure"="nature_reserve"];
  relation({south},{west},{north},{east})
    ["leisure"="nature_reserve"];
);
out center meta;"""

# ----------------------- API Communication -----------------------

def query_overpass(query: str, max_retries: int = 3) -> Dict[str, Any]:
    """Execute Overpass query with retry logic across multiple servers."""
    
    for attempt in range(max_retries):
        for server_url in OVERPASS_SERVERS:
            try:
                print(f"Querying {server_url} (attempt {attempt + 1})")
                
                data = urllib.parse.urlencode({'data': query}).encode('utf-8')
                req = urllib.request.Request(
                    server_url,
                    data=data, 
                    headers={
                        'User-Agent': USER_AGENT,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                )
                
                with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as response:
                    if response.status == 200:
                        result = json.loads(response.read().decode('utf-8'))
                        print(f"✓ Query successful: {len(result.get('elements', []))} elements")
                        return result
                    else:
                        print(f"HTTP {response.status} from {server_url}")
                        
            except Exception as e:
                print(f"Error with {server_url}: {e}")
                
        # Wait between attempts
        if attempt < max_retries - 1:
            wait_time = (attempt + 1) * 2
            print(f"Waiting {wait_time}s before retry...")
            time.sleep(wait_time)
    
    print("All Overpass servers failed")
    return {"elements": []}

# ----------------------- Data Processing -----------------------

def extract_coordinates(element: Dict[str, Any]) -> Optional[Tuple[float, float]]:
    """Extract lat/lon from an Overpass element."""
    # Try center first (for ways/relations)
    if 'center' in element:
        return element['center']['lat'], element['center']['lon']
    # Then direct coordinates (for nodes)  
    elif 'lat' in element and 'lon' in element:
        return element['lat'], element['lon']
    return None

def process_water_elements(elements: List[Dict], origin_lat: float, origin_lon: float) -> List[Dict]:
    """Process water elements into standardized records."""
    waters = []
    
    for element in elements:
        coords = extract_coordinates(element)
        if not coords:
            continue
            
        lat, lon = coords
        tags = element.get('tags', {})
        
        # Extract name
        name = (tags.get('name') or 
                tags.get('reservoir_name') or
                tags.get('official_name') or 
                'Unnamed Water Body')
        
        # Determine water type
        water_type = "Lake"
        if tags.get('water') == 'reservoir' or 'reservoir' in name.lower():
            water_type = "Reservoir"
        elif tags.get('place') == 'reservoir':
            water_type = "Reservoir"
            
        # Calculate distance
        distance_miles = haversine_distance(origin_lat, origin_lon, lat, lon)
        
        # Extract additional info
        access_info = tags.get('access', 'unknown')
        operator = tags.get('operator', 'N/A')
        website = tags.get('website', '')
        
        waters.append({
            'name': name,
            'type': water_type, 
            'lat': lat,
            'lon': lon,
            'distance_miles': round(distance_miles, 1),
            'access': access_info,
            'operator': operator,
            'website': website,
            'tags': tags
        })
    
    return waters

def process_public_lands(elements: List[Dict]) -> List[Dict]:
    """Process public land elements into standardized records."""
    lands = []
    
    for element in elements:
        coords = extract_coordinates(element)
        if not coords:
            continue
            
        lat, lon = coords
        tags = element.get('tags', {})
        
        name = (tags.get('name') or 
                tags.get('official_name') or
                'Public Land')
        
        # Determine land type
        land_type = "Public Land"
        if tags.get('boundary') == 'national_park':
            land_type = "National Park"
        elif tags.get('boundary') == 'protected_area':
            land_type = "Protected Area" 
        elif tags.get('leisure') == 'park':
            land_type = "Park"
        elif tags.get('leisure') == 'nature_reserve':
            land_type = "Nature Reserve"
            
        operator = tags.get('operator', 'N/A')
        protect_class = tags.get('protect_class', 'N/A')
        
        lands.append({
            'name': name,
            'type': land_type,
            'lat': lat,
            'lon': lon, 
            'operator': operator,
            'protect_class': protect_class,
            'tags': tags
        })
    
    return lands

def find_public_waters(waters: List[Dict], public_lands: List[Dict], max_distance_miles: float = 0.5) -> List[Dict]:
    """Filter water bodies that are on or very close to public lands."""
    public_waters = []
    
    for water in waters:
        min_distance = float('inf')
        closest_land = None
        
        # Find closest public land
        for land in public_lands:
            distance = haversine_distance(
                water['lat'], water['lon'],
                land['lat'], land['lon'] 
            )
            if distance < min_distance:
                min_distance = distance
                closest_land = land
        
        # If close enough to public land, include it
        if min_distance <= max_distance_miles and closest_land:
            water['public_land'] = closest_land['name']
            water['public_land_type'] = closest_land['type'] 
            water['distance_to_public'] = round(min_distance, 2)
            public_waters.append(water)
    
    return public_waters

# ----------------------- Output -----------------------

def display_results(waters: List[Dict], origin_lat: float, origin_lon: float):
    """Display results in a nice table format."""
    if not waters:
        print("No paddleable waters found on public lands in the specified area.")
        return
        
    print(f"\nPaddleable Waters on Public Lands near {origin_lat:.4f}, {origin_lon:.4f}")
    print("=" * 100)
    
    # Sort by distance
    waters.sort(key=lambda x: x['distance_miles'])
    
    # Print header
    print(f"{'#':<3} {'Name':<25} {'Type':<12} {'Distance':<8} {'Public Land':<20} {'Access':<8}")
    print("-" * 100)
    
    # Print each water body
    for i, water in enumerate(waters, 1):
        name = water['name'][:24]
        water_type = water['type'][:11] 
        distance = f"{water['distance_miles']} mi"
        public_land = water.get('public_land', 'Unknown')[:19]
        access = water.get('access', 'unknown')[:7]
        
        print(f"{i:<3} {name:<25} {water_type:<12} {distance:<8} {public_land:<20} {access:<8}")
    
    print(f"\nFound {len(waters)} paddleable waters on public lands")

# ----------------------- Main Function -----------------------

def main():
    parser = argparse.ArgumentParser(
        description="Find paddleable lakes and reservoirs on public lands using Overpass API"
    )
    parser.add_argument("--lat", type=float, required=True, help="Latitude of search center")
    parser.add_argument("--lon", type=float, required=True, help="Longitude of search center") 
    parser.add_argument("--radius", type=float, default=25, help="Search radius in miles (default: 25)")
    parser.add_argument("--limit", type=int, default=20, help="Maximum number of results (default: 20)")
    parser.add_argument("--public-distance", type=float, default=0.3, help="Max distance to public land in miles (default: 0.3)")
    
    args = parser.parse_args()
    
    print(f"Searching for paddleable waters within {args.radius} miles of {args.lat}, {args.lon}")
    print("This may take a moment...\n")
    
    radius_meters = miles_to_meters(args.radius)
    
    # Query water bodies
    print("1. Querying water bodies...")
    water_query = build_water_query(args.lat, args.lon, radius_meters)
    water_data = query_overpass(water_query)
    waters = process_water_elements(water_data.get('elements', []), args.lat, args.lon)
    print(f"Found {len(waters)} water bodies")
    
    # Query public lands  
    print("\n2. Querying public lands...")
    lands_query = build_public_lands_query(args.lat, args.lon, radius_meters)
    lands_data = query_overpass(lands_query)
    public_lands = process_public_lands(lands_data.get('elements', []))
    print(f"Found {len(public_lands)} public land areas")
    
    # Filter for public waters
    print(f"\n3. Finding waters within {args.public_distance} miles of public lands...")
    public_waters = find_public_waters(waters, public_lands, args.public_distance)
    
    # Apply limit and display
    if args.limit:
        public_waters = public_waters[:args.limit]
        
    display_results(public_waters, args.lat, args.lon)

if __name__ == "__main__":
    main()
