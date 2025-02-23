import csv
import requests
import os
import sys
from dotenv import load_dotenv
import time
from requests.adapters import HTTPAdapter
from requests.packages.urllib3.util.retry import Retry

# Load environment variables from .env file
load_dotenv()
token = os.getenv('GITHUB_TOKEN')

# Headers for authentication
headers = {
    'Authorization': f'token {token}',
    'Accept': 'application/vnd.github.v3.star+json', # This gets us starring timestamps
}

# Setup retry strategy for requests
retry_strategy = Retry(
    total=3,
    status_forcelist=[429, 500, 502, 503, 504],
    backoff_factor=1
)
adapter = HTTPAdapter(max_retries=retry_strategy)

def dot_spinner():
    while True:
        for num_dots in range(4):
            yield f"\rProcessing{'.' * num_dots}" + ' ' * (20 - num_dots)

def get_stargazers(repo, spin):
    api_url = f'https://api.github.com/repos/{repo}/stargazers'  # Removed direction=desc as it's not needed
    stargazers = []
    with requests.Session() as session:
        session.headers.update(headers)
        session.mount("https://", adapter)
        while True:
            response = session.get(api_url)
            sys.stdout.write(next(spin))
            sys.stdout.flush()
            
            if response.status_code != 200:
                print(f"\nError: API returned status code {response.status_code}")
                print(f"Response: {response.text}")
                break
                
            json_response = response.json()
            if not json_response:  # Empty response
                break
                
            for item in json_response:
                stargazers.append({
                    'user': item['user'],
                    'starred_at': item['starred_at']
                })
                
            if 'next' not in response.links:
                break
            api_url = response.links['next']['url']
            
    return stargazers

def get_user_details(username):
    user_api_url = f'https://api.github.com/users/{username}'
    with requests.Session() as session:
        session.headers.update(headers)
        session.mount("https://", adapter)
        response = session.get(user_api_url)
    return response.json() if response.status_code == 200 else None

def update_csv(filename, new_stargazers, spin):
    # Ensure the directory exists
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    
    # Collect new data
    new_data = []
    total = len(new_stargazers)
    for index, star_data in enumerate(new_stargazers, 1):
        if 'user' in star_data and 'login' in star_data['user']:
            # Show progress as percentage
            progress = f"\rFetching user profiles: {index}/{total} ({(index/total)*100:.1f}%)"
            sys.stdout.write(progress)
            sys.stdout.flush()
            
            user_details = get_user_details(star_data['user']['login'])
            if user_details:
                new_data.append({
                    'starred_at': star_data['starred_at'],
                    'id': user_details.get('id'),
                    'login': user_details.get('login'),
                    'name': user_details.get('name'),
                    'company': user_details.get('company'),
                    'location': user_details.get('location'),
                    'email': user_details.get('email'),
                    'bio': user_details.get('bio'),
                    'twitter_username': user_details.get('twitter_username'),
                    'followers_count': user_details.get('followers'),
                    'following_count': user_details.get('following'),
                    'public_repos': user_details.get('public_repos'),
                    'public_gists': user_details.get('public_gists'),
                    'blog': user_details.get('blog'),
                    'hireable': user_details.get('hireable'),
                    'created_at': user_details.get('created_at'),
                    'updated_at': user_details.get('updated_at')
                })
            time.sleep(0.1)  # Add small delay to avoid hitting rate limits too hard
        else:
            print("\nError: 'user' is not a dictionary or missing 'login' key")

    print("\nAll user profiles fetched. Updating CSV...")
    # Read existing data and merge
    try:
        with open(filename, mode='r', newline='', encoding='utf-8') as file:
            reader = csv.DictReader(file)
            existing_data = {row['login']: row for row in reader}  # Use login as unique key
    except FileNotFoundError:
        existing_data = {}

    # Update existing data with new data
    for new_user in new_data:
        existing_data[new_user['login']] = new_user

    # Convert updated data back to list and sort by login
    combined_data = list(existing_data.values())
    combined_data.sort(key=lambda x: x['login'])

    # Write combined data back to CSV, including header
    fieldnames = [
        'starred_at', 'id', 'login', 'name', 'company', 'location', 'email', 'bio',
        'twitter_username', 'followers_count', 'following_count',
        'public_repos', 'public_gists', 'blog', 'hireable',
        'created_at', 'updated_at'
    ]
    with open(filename, mode='w', newline='', encoding='utf-8') as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(combined_data)

def main():
    repo = input("Enter the GitHub repository (format: owner/repo): ")
    owner, repo_name = repo.split('/')
    filename = os.path.join("data", owner, f"{repo_name}.csv")  # Create owner/repo.csv structure
    print(f"Fetching stargazers for {repo}, please wait...")
    spin = dot_spinner()  # Create a dot spinner generator
    try:
        stargazers = get_stargazers(repo, spin)
        sys.stdout.write('\r' + ' ' * 50 + '\r')  # Clear the spinner line
        print(f"Total stargazers fetched: {len(stargazers)}")
        update_csv(filename, stargazers, spin)
        sys.stdout.write('\r' + ' ' * 50 + '\r')  # Clear the spinner line again
        print(f"CSV file has been updated: {filename}")
    except Exception as e:
        print(f"\nAn error occurred: {e}")

if __name__ == "__main__":
    main()