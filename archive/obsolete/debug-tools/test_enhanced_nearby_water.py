#!/usr/bin/env python3
"""
Test script for enhanced nearbyWater API with public lands support
"""

import requests
import json
import sys

# Your Kaayko API base URL
API_BASE = "https://kaaykostore-api.web.app/api"
# API_BASE = "http://localhost:5001/kaaykostore/us-central1/api"  # Use for local testing

def test_nearby_water(lat, lng, public_only=False):
    """Test the nearbyWater API endpoint"""
    
    url = f"{API_BASE}/nearbyWater"
    params = {
        "lat": lat,
        "lng": lng,
        "radius": 30  # 30km radius
    }
    
    if public_only:
        params["publicOnly"] = "true"
    
    print(f"\n{'='*60}")
    print(f"🔍 Testing nearbyWater API")
    print(f"📍 Location: {lat}, {lng}")
    print(f"🏞️ Public lands only: {public_only}")
    print(f"🔗 URL: {url}")
    print(f"📋 Params: {params}")
    print("="*60)
    
    try:
        response = requests.get(url, params=params, timeout=60)
        
        print(f"📡 Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            
            if data.get("success"):
                water_bodies = data.get("waterBodies", [])
                print(f"✅ Success! Found {len(water_bodies)} water bodies")
                
                if water_bodies:
                    print(f"\n🏆 Top Results:")
                    print("-" * 60)
                    for i, wb in enumerate(water_bodies[:5], 1):
                        public_info = ""
                        if wb.get("publicLand"):
                            public_info = f" [🏛️ {wb['publicLand']['name']} - {wb['publicLand']['distanceMiles']}mi]"
                        
                        print(f"{i:2}. {wb['name']} ({wb['type']})")
                        print(f"    📏 {wb['distanceMiles']} miles away")
                        if wb.get('access'):
                            print(f"    🚪 Access: {wb['access']}")
                        if public_info:
                            print(f"    {public_info}")
                        print()
                
                return data
            else:
                print(f"❌ API error: {data}")
                return None
        else:
            print(f"❌ HTTP error: {response.status_code}")
            print(f"📝 Response: {response.text[:500]}...")
            return None
            
    except Exception as e:
        print(f"💥 Request failed: {e}")
        return None

def main():
    """Test both regular and public-only modes"""
    
    # Test coordinates - Dallas, TX area
    test_lat = 33.1975
    test_lng = -96.6153
    
    print("🌊 KAAYKO ENHANCED NEARBYWATER API TESTING")
    print("=" * 60)
    print("This tests the enhanced nearbyWater API with Overpass integration")
    print("Same endpoint, backward compatible, with new public lands filtering!")
    
    # Test 1: Regular mode (all water bodies)
    print("\n\n🔵 TEST 1: Regular Mode (All Water Bodies)")
    regular_results = test_nearby_water(test_lat, test_lng, public_only=False)
    
    # Test 2: Public lands only mode  
    print("\n\n🟢 TEST 2: Public Lands Only Mode")
    public_results = test_nearby_water(test_lat, test_lng, public_only=True)
    
    # Summary comparison
    if regular_results and public_results:
        regular_count = len(regular_results.get("waterBodies", []))
        public_count = len(public_results.get("waterBodies", []))
        
        print(f"\n\n📊 SUMMARY COMPARISON")
        print("=" * 60)
        print(f"🔵 Regular mode: {regular_count} water bodies")
        print(f"🟢 Public only mode: {public_count} water bodies")
        print(f"📈 Public lands filtering reduced results by {regular_count - public_count} bodies")
        
        if public_count > 0:
            print(f"\n🎯 Public lakes found:")
            for wb in public_results["waterBodies"][:3]:
                public_land = wb.get("publicLand", {})
                print(f"   • {wb['name']} at {public_land.get('name', 'Unknown public land')}")

if __name__ == "__main__":
    main()
