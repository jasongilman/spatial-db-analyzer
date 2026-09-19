# Initial Project Description

I want to create a project to help me analyze the spatial intersection capabilities of various databases and libraries. It will also serve as an explainer to others who view as a way to visually see the differences in their capabilities.

Specifically, I want to understand how well they do with various geodetic polygons, ie. polygons on a spherical Earth. Ellipsoidal accuracy is not needed for my use case. These are the kinds of problems the can occur if a spatial intersection algorithm doesn't take into account that the Earth isn't a flat plane.

* Polygons can contain one or both of the poles. The winding order of the points dictates what's inside or outside of the polygon.
* Polygons crossing the antimerdian
* The shortest distance for a line on the Earth follows a great circle arc.

Spatial solutions that don't take those into account will either think the polygon is invalid or not accurately represent its position returning invalid results during spatial searches or other applications.

This solution will likely consist of two parts.

1. A backend to run the databases or spatial libraries and perform tests
2. A front end (dynamic web page) that can display the results of the various spatial tests.

## Security, Scalability, Reliability

I'll be deploying this solution in my AWS account and making it available publicly. That means security is important and avoiding unbounded costs. Scalability shouldn't be a problem as I'm expecting a limited number of users will actually know the URL (less than 12) but since I won't have access control or network restrictions we'll still need to take into account the cost implications and avoid spinning up expensive resources in response to user requests.

This isn't expected to stay around a long time and I'll take it down after about a month or two. It doesn't need the robustness that a long term solution will but I'd still like to make sure that all of the code is clean, linted, and tested sufficiently.

## Time Constraints

I also don't want to spend more than 8 hours creating this solution at max and ideally half of that. A good method to hit the time limit is to start with a simple cross cutting implementation of the entire solution and then we can iterate on it to add more as we go. I list a lot of ideas below and we may not want to do all of them.

For simplicity of this demo we won't include polygons with holes in them.

## Backend

I want to make it easy to implement, deploy and run this. Containerization is probably a good approach for running some of these databases. I could potentially deploy this all on a single Ec2 instance to make it easier.

**Spatial DBs / Libraries to test**

* DuckDB
* ElasticSearch
* S2 library
* NASA Common Metadata Repository - Spatial library - I originally implemented this around 2014 and it generally handles these cases. If it fits within our time budget it would be good to add it. It's implemented in Clojure so it might be a bit more difficult to make working.
* Please suggest others here.

## Testing

When testing the spatial solutions we'll want a set of test polygons and a way of checking them.

Test Polygon Scenarios

* "Normal" polygon
* Covers North pole
* Covers South pole
* Crosses antimerdian
* Wide polygon (Shows differences between cartesian and geodetic lines)
* Contains both poles
* Do you have suggestions here?

Testing a Polygon

* Does the library think it's valid?
* Does it cover the expected area?
  * Method Point Grid - Define a grid of points across the globe and check containment of the point in the polygon
  * Method Bounding Box - Does the library generate a bounding box that correctly covers the polygon?
* Do you have other suggestions

## Frontend

An important part of this system is the ability to easily visualize the results of a test combination (a particular polygon along with a database/library).

Here's some initial ideas

1. Ability to see a summary of all the test combinations and results
2. Ability to select a test combination and visualize the polygon and point grid on both an orthographic view and a flat planar view (ie mercator projection)
   * The "flat" view lets us see the entire world at the same time.
   * The orthographic view gives us a realistic image of the earth
3. Ability to define your own polygon and run the test
   * Maybe generating a random polygon of a different type in a particular area or dragging points from an existing polygon to see the impact.


Abilities 1 and 2 could be displayed with a completely static website and no backend. We could run and save all the test results.

Ability 3 would require a backend to run a polygon test but would be the most impressive and help develop new cases to validate.


## Code Requirements and Preferences

### Python

* Python 3.13
* uv
* rust for linting
* Pyright strict for type checks
  * Use types for everything
* pytest
* pydantic for type definitions (Use strict, extra forbid, and frozen as appropriate)

See https://github.com/Element84/natural-language-geocoding/ for the rules that I use for rust and pyright. Note the library versions are a bit out of date there. I want to use the latest.

### Web page (JS/CSS/HTML)

I'm not a designer or experienced web page developer. I'm looking to follow best practices in a similar manner to my python preferences

### Shellscripts

* Bash
* Use shellcheck
* Follow best practices
* See my NLG library mentioned previous for a few examples of lint and testing scripts

### Claude Code Extras

* Transcripts
  * For auditing purposes, I want to be able to produce a transcript of all conversations. I'm not sure of the best way to do this with Claude Code.
* Plans are saved to `plans/` folder like this plan and will become part of the git history.
