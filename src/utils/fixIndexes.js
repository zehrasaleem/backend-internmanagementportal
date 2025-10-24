import Project from "../models/project.js";

export const fixProjectIndexes = async () => {
  try {
    const indexes = await Project.collection.getIndexes({ full: true });
    const hasOldIndex = indexes.find((idx) => idx.name === "name_1");

    if (hasOldIndex) {
      console.log("⚙️ Dropping old 'name_1' index...");
      await Project.collection.dropIndex("name_1");
      console.log("✅ Dropped old 'name_1' index successfully!");
    } else {
      console.log("✅ No old 'name_1' index found — all good!");
    }

    await Project.collection.createIndex({ title: 1 }, { unique: true });
    console.log("✅ Ensured 'title' index is correct and unique.");
  } catch (err) {
    console.error("❌ Error fixing indexes:", err.message);
  }
};
