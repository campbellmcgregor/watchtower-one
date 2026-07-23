const parseArguments = (
	arguments_,
	{ boolean = [], repeatable = [] } = {},
) => {
	const [command, ...tokens] = arguments_;
	const booleanNames = new Set(boolean);
	const repeatableNames = new Set(repeatable);
	const options = Object.fromEntries(repeatable.map(name => [name, []]));

	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);

		const name = token.slice(2);
		if (booleanNames.has(name)) {
			options[name] = true;
			continue;
		}

		const value = tokens[index + 1];
		if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
		if (repeatableNames.has(name)) options[name].push(value);
		else options[name] = value;
		index += 1;
	}

	return { command, options };
};

export default parseArguments;
