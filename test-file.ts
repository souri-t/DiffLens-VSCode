// Test file to create some git diff content
const testFunction = () => {
    console.log("This is a test file");
    console.log("We'll add some changes here");
    console.log("This is a new line added for testing");
    return "modified content";
};

// Added a new function for testing
const newFunction = () => {
    return "This is completely new content";
};

export default testFunction;
export { newFunction };
