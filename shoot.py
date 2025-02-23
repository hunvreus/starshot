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
    'Accept': 'application/vnd.github.v3+json',
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
    api_url = f'https://api.github.com/repos/{repo}/stargazers?direction=desc'
    stargazers = []
    with requests.Session() as session:
        session.headers.update(headers)
        session.mount("https://", adapter)
        while True:
            response = session.get(api_url)
            sys.stdout.write(next(spin))  # Update the spinner
            sys.stdout.flush()
            json_response = response.json()
            if isinstance(json_response, list):
                stargazers.extend(json_response)
            else:
                break
            if 'next' in response.links:
                api_url = response.links['next']['url']
            else:
                break
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
    for user in new_stargazers:
        if 'login' in user:
            if spin: sys.stdout.write(next(spin))  # Update the spinner
            sys.stdout.flush()
            user_details = get_user_details(user['login'])
            if user_details:
                new_data.append({
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
        else:
            print("\nError: 'user' is not a dictionary or missing 'login' key")

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
        'id', 'login', 'name', 'company', 'location', 'email', 'bio',
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
    filename = os.path.join("data", f"{repo.replace('/', os.sep)}.csv")  # Store in data subfolder
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