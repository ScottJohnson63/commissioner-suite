Yet another file to plan things

Overall: 
I want to add a page that is designed like an AI agent. When given a prompt like "Should I start Tom Brady or Aaron Rodgers?", it parses the nfl_data_py statistics and the sleeper trending endpoint to provide a response to the user. 

General architecture:
- nfl_data_py apis should be located at /api/nfl
- sleeper trending should be located at /api/trending
- any apis needed for the agent should be located at /api/agent
- the agent itself should be located at /league/ai
- python FASTAPI app is ran on RAILWAY

To Do: 
- Add python nfl_data_py FASTAPI endpoints to project
- Add sleeper trending endpoint
- Add page for a chat bot