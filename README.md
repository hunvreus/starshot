Simple Python script that creates a CSV with the public GitHub profile info of users who starred a repo.

## Installation

1. Create your virtual environment and activate it:
   ```bash
   python3 -m venv venv && source venv/bin/activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Create a [GitHub Personal Access Token](https://github.com/settings/tokens)
   - Required scopes: `read:user`, `repo`

4. Create a `.env` file (see `.env.example`) and set your Personal Access Token:
   ```
   GITHUB_TOKEN=your_token_here
   ```

## Usage

1. Run the script:
   ```bash
   python export.py
   ```

2. Enter the repository in format `owner/repo` when prompted
3. The CSV file will be created in `data/owner/repo.csv`

Note: This may take a while, especially if for repositories with many stars as it retrieves user profiles one by one and needs to avoid GitHub's API rate limits.

## Output

The script will create a CSV file with the following columns:

| Column | Description |
|--------|-------------|
| starred_at | When the user starred the repository |
| id | GitHub user ID |
| login | GitHub username |
| name | User's display name |
| company | User's company/organization |
| location | User's location |
| email | User's public email (if available) |
| bio | User's profile biography |
| twitter_username | Twitter/X username |
| followers_count | Number of followers |
| following_count | Number of users they follow |
| public_repos | Number of public repositories |
| public_gists | Number of public gists |
| blog | URL to user's blog/website |
| created_at | Account creation date |
| updated_at | Last profile update date |

## Data Visualization

Additional visualization features are available if you install the visualization dependencies:

```bash
pip install -r requirements-visualize.txt
```

Then run:
```bash
python visualize.py
```

This will:
1. Create a cumulative stars growth chart
2. Generate an interactive world map showing stargazer distribution by country
3. Save visualizations in `visualizations/owner/repo/`