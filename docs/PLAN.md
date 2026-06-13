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
[ ] DO FIRST: Attempt to port in league/dashboard League Tab functions to the agent.
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

[x] Add sidebar from league/dashboard
[x] Add Manage button to sidebar that allows the commissioner to select PA members based on users in the database
[x] Add division selection 
[x] Add lottery picker 
[x] Add functionality for PA members (MEMBERS) to have read only access to every page. 
[x] Add Association tabs on league dashboard for pa members

-- Part 7: Auth Updates -- 
Overall: 
I want to implement the functionality to check if a user attempting to login is in the sleeper leagues. If not, then they are denied.

[x] Add username to login flow 
[x] Remove the username dialog and the disconnect features.

-- Part 8: Random odds and ends --
Overall: 

[x] Move league context dropdown for league to the top
[x] Update division and lottery tab to log in activity log
[x] Add a Generate Draft Order button to the lottery page
[x] Optimize league dashboard for mobile. If mobile, sidebar is locked in collapse mode. If mobile, the tabs become a hamburger menu selection. 
[x] Fix Schedule tab flickering after role changes
[x] Add commissioner login (the manual login method now should only be for commissioner/manually added accounts)

-- Part 9: Code Cleanup, Refactor, and issues -- 
Overall: 
Clean up the code to refactor components into separate folders. Maximize modularization, reducing functions to one specific task where possible. 

[x] Draft code cleanup plan. 
[x] Execute plan in CLEANUP_PLAN_1.md
[x] Review code for best practices in BEST_PRACTICES.md
[x] Draft plan to implement a full test suite, including automated UI tests. Should include 100% code coverage is possible. See nextjs/TEST_PLAN.md
[x] If unit tests are added leave detailed comments for each part of the unit test so that I can personally review.
[x] Add detailed documentation for all methods
[x] Remove sync league features & fix Schedules tab (might be same issue)
[x] Implement BEST_PRACTICES_REPORT.md

-- Part 10: More Quality Updates -- 
Overall: 
Improve  application infrastructure

[x] Setup GitHub Pipeline
[ ] Load test it
[ ] Set up Claude testing
[ ] Complete phased unit testing

-- Part 11: Feature updates --
Overall: 
Match league requirements

[ ] Fix divisions page
[ ] Fix lottery page
[ ] Remove league/schedule page and associated unit tests