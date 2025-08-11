import pandas as pd
import matplotlib.pyplot as plt
import folium
from geopy.geocoders import Nominatim
import time
import os
from pathlib import Path
import pycountry
from collections import Counter

def get_available_datasets():
    # List all CSV files in the data directory
    data_dir = Path('data')
    datasets = []
    
    for path in data_dir.glob('**/*.csv'):
        # Convert path to owner/repo format
        parts = path.parts[1:]  # Skip 'data' directory
        if len(parts) >= 2:
            # Include the repo name (parts[-2] for owner, parts[-1] without .csv for repo)
            owner = parts[-2]
            repo = parts[-1].replace('.csv', '')
            owner_repo = f"{owner}/{repo}"
            datasets.append((str(path), owner_repo))
    
    return datasets

def ensure_dir(path):
    os.makedirs(path, exist_ok=True)

def create_visualizations(csv_path, owner_repo):
    # Create output directory
    output_dir = Path('visualizations') / owner_repo
    ensure_dir(output_dir)
    
    # Read the CSV file
    df = pd.read_csv(csv_path)
    
    # Create cumulative stars plot
    df['starred_at'] = pd.to_datetime(df['starred_at'])
    df['date'] = df['starred_at'].dt.date
    
    daily_counts = df.groupby('date').size().reset_index(name='daily_count')
    daily_counts = daily_counts.sort_values('date')
    daily_counts['cumulative_count'] = daily_counts['daily_count'].cumsum()
    
    # Create figure
    fig, ax = plt.subplots(figsize=(10, 6))
    
    # Plot main line
    ax.plot(daily_counts['date'], daily_counts['cumulative_count'], 
            linewidth=2, color='#2196F3')
    
    # Add subtle grid
    ax.grid(True, linestyle='--', alpha=0.3)
    
    # Remove top and right spines
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    
    # Customize labels
    ax.set_xlabel('Date')
    ax.set_ylabel('Cumulative Stars')
    ax.set_title(f'Cumulative GitHub Stars - {owner_repo}')
    
    # Rotate x-axis labels for better readability
    plt.xticks(rotation=45)
    
    # Add final count
    final_count = daily_counts['cumulative_count'].iloc[-1]
    ax.annotate(f'Total: {final_count:,}',
                xy=(daily_counts['date'].iloc[-1], final_count),
                xytext=(10, 0), textcoords='offset points')
    
    # Adjust layout
    plt.tight_layout()
    
    # Save the plot
    plot_path = output_dir / 'stars_plot.png'
    plt.savefig(plot_path, bbox_inches='tight')
    plt.close()
    
    # Create and save the map
    m = create_user_map(df)
    map_path = output_dir / 'users_map.html'
    m.save(str(map_path))
    
    return plot_path, map_path

def create_user_map(df):
    print("Creating choropleth map...")
    
    # Initialize country counter
    country_counts = Counter()
    
    # Get list of all country names and their common variations
    country_names = {}
    country_codes_to_names = {}  # Reverse lookup for display
    for country in pycountry.countries:
        country_names[country.name.lower()] = country.alpha_3
        country_codes_to_names[country.alpha_3] = country.name
        if hasattr(country, 'common_name'):
            country_names[country.common_name.lower()] = country.alpha_3
        if hasattr(country, 'official_name'):
            country_names[country.official_name.lower()] = country.alpha_3
    
    # Count users by country
    total_users = len(df)  # Total number of users in dataset
    mapped_users = 0  # Initialize counter for mapped users
    
    for location in df['location'].dropna():
        location = location.lower()
        # Try to find country in location string
        for country_name, country_code in country_names.items():
            if country_name in location:
                country_counts[country_code] += 1
                mapped_users += 1
                break
    
    # Convert to DataFrame for choropleth
    country_data = pd.DataFrame(
        list(country_counts.items()),
        columns=['Country', 'Count']
    )
    
    # Calculate stats
    top_countries = country_data.nlargest(5, 'Count')
    
    # Create map
    m = folium.Map(location=[20, 0], zoom_start=2)
    
    # Add choropleth layer
    choropleth = folium.Choropleth(
        geo_data='https://raw.githubusercontent.com/python-visualization/folium/master/examples/data/world-countries.json',
        name='choropleth',
        data=country_data,
        columns=['Country', 'Count'],
        key_on='feature.id',
        fill_color='YlOrRd',
        fill_opacity=0.7,
        line_opacity=0.2,
        legend_name='Number of Stargazers',
        nan_fill_color='transparent',
        highlight=True
    ).add_to(m)
    
    # Add hover functionality showing country stats
    for feature in choropleth.geojson.data['features']:
        country_code = feature['id']
        if country_code in country_counts:
            count = country_counts[country_code]
            feature['properties']['tooltip'] = f"{feature['properties']['name']}: {count}"
        else:
            feature['properties']['tooltip'] = f"{feature['properties']['name']}: 0"
    
    # Add tooltips to the choropleth
    choropleth.geojson.add_child(
        folium.features.GeoJsonTooltip(
            fields=['tooltip'],
            aliases=[''],  # Empty alias to avoid label
            style=('background-color: white; color: #333333; font-family: arial; font-size: 12px; padding: 10px;')
        )
    )
    
    # Add custom info box with overall stats
    info_html = f"""
        <div style="position: fixed; 
                    bottom: 50px; left: 50px; width: 250px;
                    border:2px solid grey; z-index:9999; font-size:14px;
                    background-color: white;
                    padding: 10px;
                    border-radius: 5px;">
            <h4 style="margin-top:0;">Stargazer Statistics</h4>
            <b>Mapped Users:</b> {mapped_users} out of {total_users}<br>
            <b>Top 5 Countries:</b><br>
            {'<br>'.join(f"• {country_codes_to_names.get(row['Country'], row['Country'])}: {row['Count']}" 
                        for _, row in top_countries.iterrows())}
        </div>
    """
    m.get_root().html.add_child(folium.Element(info_html))
    
    # Add layer control
    folium.LayerControl().add_to(m)
    
    return m

def main():
    # Get available datasets
    datasets = get_available_datasets()
    
    if not datasets:
        print("No datasets found in the data directory!")
        return
    
    # Show available datasets
    print("\nAvailable datasets:")
    for i, (path, owner_repo) in enumerate(datasets, 1):
        print(f"{i}. {owner_repo}")
    
    # Get user selection
    while True:
        try:
            selection = int(input("\nSelect a dataset (enter number): ")) - 1
            if 0 <= selection < len(datasets):
                break
            print("Invalid selection. Please try again.")
        except ValueError:
            print("Please enter a valid number.")
    
    csv_path, owner_repo = datasets[selection]
    
    # Create visualizations
    plot_path, map_path = create_visualizations(csv_path, owner_repo)
    
    print(f"\nVisualizations created:")
    print(f"- Stars plot: {plot_path}")
    print(f"- Users map: {map_path}")

if __name__ == "__main__":
    main()