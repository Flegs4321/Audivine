-- Add DELETE policy to allow deleting recordings
CREATE POLICY "Allow public delete" ON recordings
  FOR DELETE
  USING (true);

