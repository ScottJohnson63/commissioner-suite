Yet another file to plan things

--Part 1: Artificially Intelligent --
Overall: 
I want to add a page that is designed like an AI agent. When given a prompt like "Should I start Tom Brady or Aaron Rodgers?", it parses the nfl_data_py statistics and the sleeper trending endpoint to provide a response to the user. 

General architecture:
- nfl_data_py apis should be located at /api/nfl
- sleeper trending should be located at /api/trending
- any apis needed for the agent should be located at /api/agent
- the agent itself should be located at /league/ai
- python FASTAPI app is ran on RAILWAY

To Do: 
[x] Add python nfl_data_py FASTAPI endpoints to project
[x] Add sleeper trending endpoint
[x] Add page for a chat bot

-- Part 2: For free ? -- 
Overall: 
I want to add some safety restrictions on my APIs that are used within the agent so that I don't get blocked by sleeper, an AI agent platform, or upcharged for any deployment services. Also, I want to migrate to a completely free stack (removing railway)

To Do:
[x] Transition from railway
[x] Transition from groq to Google AI Studio 
[x] Rate limit sleeper
[x] Rate limit AI agent for a prompt session (e.g., max 3 prompts every 5 hours - consider a future refactor to do this per user)

-- Part 3: Make not mistakes -- 
Overall: 
I want to update the agent to utilize a good range of data, refine and tweek the prompts to ensure accuracy of data as needed

To do: 
[ ] Update the data sets from nfl data py to look at specific years 
[ ] Validate and verify sleeper data is accurate
[ ] Document other prompt issues

-- Part 4: Separate League & Players Association Portals -- 
Overall:
I want two distinguish two different portals. One is the league portal. This will have a dashboard with all different league stats and information. Second is the players association portal. This is where the current dashboard will go. PA members will have read only access. 

[x] Convert current home page into a login page. 
[x] Create a league dashboard page
[x] Move existing dashboard to players association dashboard at /assoc/dashboard

-- Part 5: Add League Features -- 
Overall: 
I want to add some useful functions for the league. First, a waiver wire suggestion that analyzes the users recent scoring vs players on the waiver wire to suggest a player. Second, a trade analyzer that helps players identify good trades. Lastly, a weekly matchup report that specifically analyzes your opponents starters vs your starters and suggests who to start and sit. 

[x] Waiver wire suggestion 
[x] Trade analyzer
[x] Weekly matchup report 
[x] Added demo mode for testing
[ ] Refine 

-- Part 6: Commissioner Controls -- 
Overall: 
I want to add the ability for commissioners to assign PA roles to users. These grant access to assoc/dashboard, but restricts sync league and generate schedule button. Also want to add a division selection button and lottery picker. 

[ ] Add sidebar from league/dashboard (migrate sync leagues and generate schedule buttons to the sidebar)
[ ] Add Manage button to sidebar that allows the commissioner to select PA members based on users in the database
[ ] Add division selection 
[ ] Add lottery picker 
[ ] Add functionality for PA members to have read only access to every page. 

-- Part 7: Auth Updates -- 
Overall: 
I want to implement the functionality to check if a user attempting to login is in the sleeper leagues. If not, then they are denied.

[ ] Add username to login flow 
[ ] Remove the username dialog and the disconnect features.