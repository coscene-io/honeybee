export default [
  {
    rules: {
      "file-progress/activate": "off",
      "prettier/prettier": "error",
      "import/no-self-import": "error",
      "import/no-duplicates": "error",

      "import/no-cycle": [
        "error",
        {
          ignoreExternal: true,
        },
      ],
    },
  },
];
