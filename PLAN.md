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
[ ] Transition from railway
[ ] Transition from groq to Google AI Studio 
[ ] Rate limit sleeper
[ ] Rate limit AI agent for a prompt session (e.g., max 3 prompts every 5 hours - consider a future refactor to do this per user)

-- Part 3: Make not mistakes -- 
I want to update the agent to utilize a good range of data, refine and tweek the prompts to ensure accuracy of data as needed

To do: 
[ ] Update the data sets from nfl data py to look at specific years 
[ ] Validate and verify sleeper data is accurate
[ ] Document other prompt issues